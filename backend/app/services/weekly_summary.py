import logging
import uuid
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget_goal import BudgetGoal
from app.models.transaction import Transaction
from app.services.llm_provider import get_provider

logger = logging.getLogger(__name__)

_CAT_DISPLAY: dict[str, str] = {
    "market": "Market",
    "restoran": "Restoran & Kafe",
    "ulasim": "Ulaşım",
    "eglence": "Eğlence",
    "saglik": "Sağlık",
    "fatura": "Fatura & Abonelik",
    "giyim": "Giyim",
    "nakit_atm": "Nakit / ATM",
    "transfer": "Transfer",
    "iade": "İade",
    "vergi": "Vergi & Komisyon",
    "teknoloji": "Teknoloji",
    "diger": "Diğer",
}

_INSIGHT_SYSTEM = """\
Sen Mizan adlı Türk kişisel finans koçusun. Kısa, samimi ve motive edici yazıyorsun.
"""

_INSIGHT_USER = """\
Kullanıcının bu haftaki harcama özeti:
- Toplam harcama: {this_week_spend} ₺
- Geçen haftaya göre değişim: {change_str}
- En yüksek kategori: {top_cat}
- En çok harcama yapılan merchant: {top_merchant}

Tam olarak 3 cümle yaz. Türkçe. Samimi ve destekleyici ton. Rakam tekrarlama.
"""


async def _fetch_period(
    user_id: uuid.UUID,
    start: date,
    end: date,
    session: AsyncSession,
) -> list[Transaction]:
    result = await session.execute(
        select(Transaction).where(
            Transaction.user_id == user_id,
            Transaction.transaction_date >= start,
            Transaction.transaction_date <= end,
        )
    )
    return list(result.scalars().all())


def _debit_total(txs: list[Transaction]) -> Decimal:
    return sum((t.amount for t in txs if t.transaction_type == "debit"), Decimal("0"))


def _by_category(txs: list[Transaction]) -> dict[str, Decimal]:
    totals: dict[str, Decimal] = {}
    for t in txs:
        if t.transaction_type == "debit":
            cat = t.category or "diger"
            totals[cat] = totals.get(cat, Decimal("0")) + t.amount
    return dict(sorted(totals.items(), key=lambda x: x[1], reverse=True))


def _top_merchant(txs: list[Transaction]) -> str | None:
    counts: dict[str, Decimal] = {}
    for t in txs:
        if t.transaction_type == "debit":
            key = t.description[:30].strip()
            counts[key] = counts.get(key, Decimal("0")) + t.amount
    if not counts:
        return None
    return max(counts, key=lambda k: counts[k])


async def _goal_status(
    user_id: uuid.UUID,
    month_txs: list[Transaction],
    session: AsyncSession,
) -> list[dict]:
    result = await session.execute(
        select(BudgetGoal)
        .where(BudgetGoal.user_id == user_id)
        .order_by(BudgetGoal.category)
    )
    goals = result.scalars().all()
    if not goals:
        return []

    spent_by_cat: dict[str, Decimal] = {}
    for t in month_txs:
        if t.transaction_type == "debit" and t.category:
            spent_by_cat[t.category] = spent_by_cat.get(t.category, Decimal("0")) + t.amount

    items = []
    for g in goals:
        spent = spent_by_cat.get(g.category, Decimal("0"))
        pct = float(spent / g.monthly_limit * 100) if g.monthly_limit > 0 else 0.0
        if pct >= 100:
            status = "exceeded"
        elif pct >= 80:
            status = "warning"
        else:
            status = "ok"
        items.append({
            "category": g.category,
            "monthly_limit": g.monthly_limit,
            "spent": spent,
            "pct_used": round(pct, 1),
            "status": status,
        })
    return items


def _llm_insight(
    this_week_spend: Decimal,
    last_week_spend: Decimal,
    by_category: dict[str, Decimal],
    top_merchant: str | None,
) -> str:
    provider = get_provider()
    if not by_category:
        return "Bu hafta henüz harcama verisi yok."

    top_cat = _CAT_DISPLAY.get(next(iter(by_category)), "Diğer")

    if last_week_spend > 0:
        change_pct = float((this_week_spend - last_week_spend) / last_week_spend * 100)
        if change_pct > 0:
            change_str = f"%{abs(change_pct):.0f} artış"
        elif change_pct < 0:
            change_str = f"%{abs(change_pct):.0f} azalış"
        else:
            change_str = "değişim yok"
    else:
        change_str = "karşılaştırma için geçen hafta verisi yok"

    prompt = _INSIGHT_USER.format(
        this_week_spend=f"{this_week_spend:.2f}",
        change_str=change_str,
        top_cat=top_cat,
        top_merchant=top_merchant or "bilinmiyor",
    )

    try:
        response = provider.client.chat.completions.create(
            model=provider.model,
            messages=[
                {"role": "system", "content": _INSIGHT_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=200,
        )
        return response.choices[0].message.content or ""
    except Exception as exc:
        logger.error("Weekly insight LLM failed: %s", exc)
        return "Bu haftaki harcamalarını incelemeye devam et — her küçük adım fark yaratır."


async def generate_summary(user_id: uuid.UUID, session: AsyncSession) -> dict:
    today = date.today()

    # This week: Monday → today
    days_since_monday = today.weekday()
    this_week_start = today - timedelta(days=days_since_monday)
    this_week_end = today

    # Last week: previous Mon → Sun
    last_week_end = this_week_start - timedelta(days=1)
    last_week_start = last_week_end - timedelta(days=6)

    # This calendar month (for goal status)
    month_start = date(today.year, today.month, 1)

    this_week_txs = await _fetch_period(user_id, this_week_start, this_week_end, session)
    last_week_txs = await _fetch_period(user_id, last_week_start, last_week_end, session)
    month_txs = await _fetch_period(user_id, month_start, today, session)

    this_week_spend = _debit_total(this_week_txs)
    last_week_spend = _debit_total(last_week_txs)
    this_by_cat = _by_category(this_week_txs)
    last_by_cat = _by_category(last_week_txs)

    if last_week_spend > 0:
        change_pct = float((this_week_spend - last_week_spend) / last_week_spend * 100)
    else:
        change_pct = 0.0

    top_merchant = _top_merchant(this_week_txs)
    goals = await _goal_status(user_id, month_txs, session)
    insight = _llm_insight(this_week_spend, last_week_spend, this_by_cat, top_merchant)

    return {
        "this_week": {
            "total_spent": this_week_spend,
            "by_category": this_by_cat,
            "start_date": this_week_start,
            "end_date": this_week_end,
        },
        "last_week": {
            "total_spent": last_week_spend,
            "by_category": last_by_cat,
        },
        "change_pct": round(change_pct, 1),
        "goals": goals,
        "top_merchant": top_merchant,
        "insight": insight,
    }


def _make_bar(pct: float, width: int = 10) -> str:
    filled = min(int(pct / 100 * width), width)
    return "█" * filled + "░" * (width - filled)


def render_email(summary: dict, user_email: str) -> str:
    this_week = summary["this_week"]
    last_week = summary["last_week"]
    change_pct: float = summary["change_pct"]
    goals: list[dict] = summary["goals"]
    insight: str = summary["insight"]

    total_spent: Decimal = this_week["total_spent"]
    start_date: date = this_week["start_date"]
    end_date: date = this_week["end_date"]

    # Change badge
    if change_pct > 0:
        badge_color = "#dc2626"
        badge_text = f"↑{abs(change_pct):.0f}% geçen haftaya göre"
    elif change_pct < 0:
        badge_color = "#16a34a"
        badge_text = f"↓{abs(change_pct):.0f}% geçen haftaya göre"
    else:
        badge_color = "#6b7280"
        badge_text = "Geçen haftayla aynı"

    # Category rows
    cat_rows = ""
    for cat, amount in this_week["by_category"].items():
        display = _CAT_DISPLAY.get(cat, cat)
        last_amount = last_week["by_category"].get(cat, Decimal("0"))
        diff = amount - last_amount
        diff_str = f'+{diff:.2f} ₺' if diff > 0 else f'{diff:.2f} ₺'
        diff_color = "#dc2626" if diff > 0 else "#16a34a"
        cat_rows += f"""
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#374151;">{display}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:right;color:#111827;font-weight:600;">{amount:.2f} ₺</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:right;color:{diff_color};font-size:12px;">{diff_str}</td>
        </tr>"""

    # Goals rows
    goal_rows = ""
    for g in goals:
        display = _CAT_DISPLAY.get(g["category"], g["category"])
        bar = _make_bar(g["pct_used"])
        pct = g["pct_used"]
        if g["status"] == "exceeded":
            bar_color = "#dc2626"
            status_label = "Aşıldı"
        elif g["status"] == "warning":
            bar_color = "#d97706"
            status_label = "Uyarı"
        else:
            bar_color = "#059669"
            status_label = "Yolunda"
        goal_rows += f"""
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#374151;">{display}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-family:monospace;color:{bar_color};">{bar} {pct:.0f}%</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;font-size:12px;color:{bar_color};">{status_label}</td>
        </tr>"""

    goals_section = ""
    if goals:
        goals_section = f"""
      <div style="background:#ffffff;border-radius:12px;padding:24px;margin-bottom:24px;border:1px solid #e5e7eb;">
        <h2 style="margin:0 0 16px;font-size:16px;font-weight:700;color:#111827;">Aylık Hedefler</h2>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <thead>
            <tr>
              <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:500;border-bottom:2px solid #e5e7eb;">Kategori</th>
              <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:500;border-bottom:2px solid #e5e7eb;">İlerleme</th>
              <th style="padding:8px 12px;text-align:right;font-size:12px;color:#6b7280;font-weight:500;border-bottom:2px solid #e5e7eb;">Durum</th>
            </tr>
          </thead>
          <tbody>{goal_rows}</tbody>
        </table>
      </div>"""

    cat_section = ""
    if cat_rows:
        cat_section = f"""
      <div style="background:#ffffff;border-radius:12px;padding:24px;margin-bottom:24px;border:1px solid #e5e7eb;">
        <h2 style="margin:0 0 16px;font-size:16px;font-weight:700;color:#111827;">Kategori Dağılımı</h2>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <thead>
            <tr>
              <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:500;border-bottom:2px solid #e5e7eb;">Kategori</th>
              <th style="padding:8px 12px;text-align:right;font-size:12px;color:#6b7280;font-weight:500;border-bottom:2px solid #e5e7eb;">Bu Hafta</th>
              <th style="padding:8px 12px;text-align:right;font-size:12px;color:#6b7280;font-weight:500;border-bottom:2px solid #e5e7eb;">Değişim</th>
            </tr>
          </thead>
          <tbody>{cat_rows}</tbody>
        </table>
      </div>"""

    week_label = f"{start_date.strftime('%-d %b')} – {end_date.strftime('%-d %b %Y')}"

    return f"""<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Haftalık Finansal Özet — Mizan</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#4f46e5;border-radius:12px 12px 0 0;padding:32px 32px 24px;text-align:center;">
              <div style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-1px;">⚖ Mizan</div>
              <div style="font-size:13px;color:#c7d2fe;margin-top:6px;">Haftalık Finansal Özet · {week_label}</div>
            </td>
          </tr>

          <!-- Hero -->
          <tr>
            <td style="background:#3730a3;padding:28px 32px;text-align:center;">
              <div style="font-size:13px;color:#a5b4fc;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Bu Hafta Harcadın</div>
              <div style="font-size:48px;font-weight:800;color:#ffffff;">{total_spent:.2f} <span style="font-size:28px;font-weight:400;">₺</span></div>
              <div style="margin-top:12px;">
                <span style="display:inline-block;background:{badge_color};color:#ffffff;padding:5px 14px;border-radius:20px;font-size:13px;font-weight:600;">{badge_text}</span>
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#f9fafb;padding:24px 24px 0;">

              {cat_section}

              {goals_section}

              <!-- LLM Insight -->
              <div style="background:#eff6ff;border-radius:12px;padding:24px;margin-bottom:24px;border:1px solid #bfdbfe;">
                <div style="font-size:13px;font-weight:600;color:#3730a3;margin-bottom:10px;">💡 Koç Yorumu</div>
                <p style="margin:0;font-size:15px;color:#1e3a8a;line-height:1.7;">{insight}</p>
              </div>

              <!-- CTA -->
              <div style="text-align:center;margin-bottom:32px;">
                <a href="http://localhost:3000/transactions"
                   style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;">
                  Mizan'ı Aç →
                </a>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:16px 32px 40px;text-align:center;border-radius:0 0 12px 12px;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                Bu e-postayı <strong>{user_email}</strong> adresine gönderiyoruz.<br>
                Haftalık özetleri kapatmak için uygulamada Ayarlar → E-posta seçeneğini kullanın.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""
