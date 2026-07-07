"use client";

import { useEffect, useRef, useState } from "react";
import { getMarketQuote, searchMarketSymbols, type MarketSearchResult } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { AssetFormProps, buildSourceDetail, previewLine, sharedInputClass, useUsdRates } from "./shared";

const EXCHANGES = [
  { value: "AUTO",   labelKey: "assetForm.exchange.auto" },
  { value: "BIST",   labelKey: "assetForm.exchange.bist" },
  { value: "NASDAQ", labelKey: "assetForm.exchange.nasdaq" },
  { value: "NYSE",   labelKey: "assetForm.exchange.nyse" },
] as const;

export default function MarketAssetForm({ assetType, onDraftChange, displayCurrency }: AssetFormProps) {
  const { t } = useLanguage();
  const { usdPriceOf, rates } = useUsdRates();
  const isFund = assetType === "fund";

  const [exchange, setExchange] = useState("AUTO");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [quoting, setQuoting] = useState(false);
  const [quotePrice, setQuotePrice] = useState<number | null>(null);
  const [quoteCurrency, setQuoteCurrency] = useState<string>("USD");
  const [quoteName, setQuoteName] = useState<string>("");
  const [yahooSymbol, setYahooSymbol] = useState<string>("");
  const [tried, setTried] = useState(false);
  const [shares, setShares] = useState("");
  const [manualValue, setManualValue] = useState("");

  const quoteFailed = tried && quotePrice === null;
  const hasQuote = quotePrice !== null;

  // Search-by-name: users rarely know ticker codes, so typing "Apple" should surface
  // "Apple Inc. (AAPL)" to pick from. Debounced; suppressed right after a pick.
  const [suggestions, setSuggestions] = useState<MarketSearchResult[]>([]);
  const skipSearchRef = useRef(false);

  function resetQuote() {
    setQuotePrice(null);
    setQuoteCurrency("USD");
    setQuoteName("");
    setYahooSymbol("");
    setTried(false);
  }

  async function lookup(overrideSymbol?: string) {
    const sym = (overrideSymbol ?? symbol).trim().toUpperCase();
    if (!sym || quoting) return;
    setSuggestions([]);
    setQuoting(true);
    setTried(true);
    try {
      const res = await getMarketQuote(sym, exchange);
      setQuotePrice(res.price);
      setQuoteCurrency(res.currency ?? "USD");
      setYahooSymbol(res.yahoo_symbol ?? sym);
      if (res.name && !name.trim()) setName(res.name);
      if (res.name) setQuoteName(res.name);
    } catch {
      setQuotePrice(null);
    } finally {
      setQuoting(false);
    }
  }

  function pickSuggestion(r: MarketSearchResult) {
    skipSearchRef.current = true;
    setSymbol(r.symbol);
    if (r.name && !name.trim()) setName(r.name);
    setSuggestions([]);
    resetQuote();
    void lookup(r.symbol);
  }

  useEffect(() => {
    if (skipSearchRef.current) {
      skipSearchRef.current = false;
      return;
    }
    const q = symbol.trim();
    if (q.length < 2 || hasQuote) {
      setSuggestions([]);
      return;
    }
    const id = setTimeout(() => {
      searchMarketSymbols(q).then((results) => setSuggestions(results.slice(0, 6))).catch(() => setSuggestions([]));
    }, 350);
    return () => clearTimeout(id);
  }, [symbol, hasQuote]);

  // USD equivalent of the quoted price
  const priceInUsd = (() => {
    if (quotePrice === null) return null;
    if (quoteCurrency.toUpperCase() === "USD") return quotePrice;
    const fxRate = usdPriceOf(quoteCurrency);
    return fxRate !== null ? quotePrice * fxRate : null;
  })();

  useEffect(() => {
    const sym = (yahooSymbol || symbol).trim().toUpperCase();
    const sharesN = parseFloat(shares);
    const manualN = parseFloat(manualValue);

    if (hasQuote && sharesN > 0 && priceInUsd !== null) {
      const totalUsd = priceInUsd * sharesN;
      const sd = buildSourceDetail({
        subtype: assetType, symbol: sym, code: sym,
        name: name.trim() || quoteName, venue: exchange,
        shares, last_price_usd: priceInUsd,
        quote_currency: quoteCurrency, quote_price: quotePrice ?? undefined,
      });
      onDraftChange({ name: name.trim() || quoteName || sym, asset_type: assetType, currency: "USD", current_value: totalUsd.toFixed(2), source_detail: sd, quantity: shares, unit_code: sym });
    } else if (quoteFailed && manualN > 0 && sym) {
      const sd = buildSourceDetail({ subtype: assetType, symbol: sym, code: sym, name: name.trim(), venue: exchange });
      onDraftChange({ name: name.trim() || sym, asset_type: assetType, currency: "USD", current_value: manualValue, source_detail: sd });
    } else {
      onDraftChange(null);
    }
  }, [symbol, name, exchange, quotePrice, quoteCurrency, yahooSymbol, shares, manualValue, quoteFailed]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalUsd = hasQuote && priceInUsd !== null && shares ? priceInUsd * parseFloat(shares || "0") : null;
  const preview = totalUsd !== null ? previewLine(totalUsd, displayCurrency, rates) : null;

  const nativePriceStr = (() => {
    if (quotePrice === null) return null;
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: quoteCurrency, maximumFractionDigits: 4 }).format(quotePrice);
    } catch {
      return `${quotePrice} ${quoteCurrency}`;
    }
  })();

  return (
    <div className="space-y-4">
      {/* Exchange selector */}
      <div>
        <label className="block text-xs text-ink-mute mb-1.5">{t("assetForm.exchangeLabel")}</label>
        <div className="flex flex-wrap gap-1.5">
          {EXCHANGES.map((ex) => {
            const label = t(ex.labelKey) !== ex.labelKey ? t(ex.labelKey) : ex.value;
            return (
              <button key={ex.value} type="button"
                onClick={() => { setExchange(ex.value); resetQuote(); }}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  exchange === ex.value
                    ? "bg-[#176B5B]/10 border-[#176B5B]/30 text-[#176B5B]"
                    : "bg-canvas border-line text-ink-mute hover:border-[#176B5B]"
                }`}>
                {label}
              </button>
            );
          })}
        </div>
        {exchange === "BIST" && <p className="text-[11px] text-ink-mute mt-1.5">{t("assetForm.bistHint")}</p>}
        {exchange === "AUTO" && <p className="text-[11px] text-ink-mute mt-1.5">{t("assetForm.otherExchangeHint")}</p>}
      </div>

      {/* Ticker or name + lookup */}
      <div>
        <label className="block text-xs text-ink-mute mb-1.5">
          {isFund ? t("assetForm.fundCodeLabel") : t("assetForm.tickerLabel")}
        </label>
        <div className="relative">
          <div className="flex gap-2">
            <input value={symbol}
              onChange={(e) => { setSymbol(e.target.value.toUpperCase()); resetQuote(); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void lookup(); } }}
              placeholder={exchange === "BIST" ? t("assetForm.bistTickerHint") : isFund ? t("assetForm.fundCodeHint") : t("assetForm.tickerHint")}
              className={sharedInputClass + " uppercase"} />
            <button type="button" onClick={() => void lookup()} disabled={!symbol.trim() || quoting}
              className="shrink-0 px-3 py-2 rounded-lg bg-[#176B5B]/10 text-[#176B5B] border border-[#176B5B]/30 hover:bg-[#176B5B]/20 disabled:opacity-40 text-xs font-medium transition-colors">
              {quoting ? t("assetForm.fetching") : t("assetForm.lookup")}
            </button>
          </div>
          {/* Name-search results — pick one to fill the ticker and quote it */}
          {suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-lg border border-line bg-surface shadow-lg overflow-hidden">
              {suggestions.map((r) => (
                <button key={r.symbol} type="button" onClick={() => pickSuggestion(r)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[#176B5B]/[0.07] transition-colors">
                  <span className="min-w-0">
                    <span className="block text-sm text-ink truncate">{r.name}</span>
                    <span className="block text-[11px] text-ink-mute">{r.symbol}{r.exchange ? ` · ${r.exchange}` : ""}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-[#176B5B] font-medium">{t("assetForm.searchPick")}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-[11px] text-ink-mute mt-1.5">{t("assetForm.tickerExamples")}</p>
      </div>

      {/* Quote result */}
      {hasQuote && (
        <>
          <div className="rounded-lg bg-pos/10 border border-pos/30 px-3 py-2 space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-mute">{t("assetForm.livePrice")}</span>
              <span className="text-sm text-pos font-semibold tabular-nums">{nativePriceStr}</span>
            </div>
            {quoteName && <p className="text-xs text-ink-mute truncate">{quoteName}</p>}
            {yahooSymbol && yahooSymbol !== symbol.toUpperCase() && (
              <p className="text-[10px] text-ink-mute">Yahoo: {yahooSymbol}</p>
            )}
          </div>
          <div>
            <label className="block text-xs text-ink-mute mb-1.5">{t("assetForm.shares")}</label>
            <input type="number" min="0" step="any" value={shares} onChange={(e) => setShares(e.target.value)}
              placeholder={t("assetForm.sharesHint")} className={sharedInputClass} />
            {preview && <p className="text-pos text-xs mt-1.5">{preview}</p>}
          </div>
        </>
      )}

      {/* Manual fallback — shown immediately on failure. Also lets the user name it,
          since there's no live quote to derive the name from. */}
      {quoteFailed && (
        <div className="space-y-3">
          <p className="text-warn text-xs">{t("assetForm.marketManualNote")}</p>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder={t("assetForm.nameOptional")} className={sharedInputClass} />
          <div>
            <label className="block text-xs text-ink-mute mb-1.5">{t("assetForm.totalValueUsd")}</label>
            <input type="number" min="0" step="0.01" value={manualValue} onChange={(e) => setManualValue(e.target.value)}
              placeholder="0.00" className={sharedInputClass} />
          </div>
        </div>
      )}
    </div>
  );
}
