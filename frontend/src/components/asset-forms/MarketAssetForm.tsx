"use client";

import { useEffect, useState } from "react";
import { getMarketQuote } from "@/lib/api";
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
  const [venue, setVenue] = useState("");
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

  function resetQuote() {
    setQuotePrice(null);
    setQuoteCurrency("USD");
    setQuoteName("");
    setYahooSymbol("");
    setTried(false);
  }

  async function lookup() {
    const sym = symbol.trim().toUpperCase();
    if (!sym || quoting) return;
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
        name: name.trim() || quoteName, venue: venue.trim() || exchange,
        shares, last_price_usd: priceInUsd,
        quote_currency: quoteCurrency, quote_price: quotePrice ?? undefined,
      });
      onDraftChange({ name: name.trim() || quoteName || sym, asset_type: assetType, currency: "USD", current_value: totalUsd.toFixed(2), source_detail: sd, quantity: shares, unit_code: sym });
    } else if (quoteFailed && manualN > 0 && sym) {
      const sd = buildSourceDetail({ subtype: assetType, symbol: sym, code: sym, name: name.trim(), venue: venue.trim() || exchange });
      onDraftChange({ name: name.trim() || sym, asset_type: assetType, currency: "USD", current_value: manualValue, source_detail: sd });
    } else {
      onDraftChange(null);
    }
  }, [symbol, name, venue, exchange, quotePrice, quoteCurrency, yahooSymbol, shares, manualValue, quoteFailed]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.exchangeLabel")}</label>
        <div className="flex flex-wrap gap-1.5">
          {EXCHANGES.map((ex) => {
            const label = t(ex.labelKey) !== ex.labelKey ? t(ex.labelKey) : ex.value;
            return (
              <button key={ex.value} type="button"
                onClick={() => { setExchange(ex.value); resetQuote(); }}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  exchange === ex.value
                    ? "bg-indigo-600/20 border-indigo-600/50 text-indigo-300"
                    : "bg-[#11100E] border-[#2C2922] text-gray-400 hover:border-indigo-700"
                }`}>
                {label}
              </button>
            );
          })}
        </div>
        {exchange === "BIST" && <p className="text-[11px] text-gray-600 mt-1.5">{t("assetForm.bistHint")}</p>}
        {exchange === "AUTO" && <p className="text-[11px] text-gray-600 mt-1.5">{t("assetForm.otherExchangeHint")}</p>}
      </div>

      {/* Ticker + lookup */}
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">
          {isFund ? t("assetForm.fundCodeLabel") : t("assetForm.tickerLabel")}
        </label>
        <div className="flex gap-2">
          <input value={symbol}
            onChange={(e) => { setSymbol(e.target.value.toUpperCase()); resetQuote(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void lookup(); } }}
            placeholder={exchange === "BIST" ? t("assetForm.bistTickerHint") : isFund ? t("assetForm.fundCodeHint") : t("assetForm.tickerHint")}
            className={sharedInputClass + " uppercase"} />
          <button type="button" onClick={() => void lookup()} disabled={!symbol.trim() || quoting}
            className="shrink-0 px-3 py-2 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-800/40 hover:bg-indigo-600/30 disabled:opacity-40 text-xs font-medium transition-colors">
            {quoting ? t("assetForm.fetching") : t("assetForm.lookup")}
          </button>
        </div>
      </div>

      {/* Quote result */}
      {hasQuote && (
        <>
          <div className="rounded-lg bg-emerald-950/20 border border-emerald-900/30 px-3 py-2 space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">{t("assetForm.livePrice")}</span>
              <span className="text-sm text-emerald-300 font-semibold tabular-nums">{nativePriceStr}</span>
            </div>
            {quoteName && <p className="text-xs text-gray-500 truncate">{quoteName}</p>}
            {yahooSymbol && yahooSymbol !== symbol.toUpperCase() && (
              <p className="text-[10px] text-gray-600">Yahoo: {yahooSymbol}</p>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.shares")}</label>
            <input type="number" min="0" step="any" value={shares} onChange={(e) => setShares(e.target.value)}
              placeholder={t("assetForm.sharesHint")} className={sharedInputClass} />
            {preview && <p className="text-emerald-400/80 text-xs mt-1.5">{preview}</p>}
          </div>
        </>
      )}

      {/* Manual fallback — shown immediately on failure, no retry loop */}
      {quoteFailed && (
        <div>
          <p className="text-amber-400/80 text-xs mb-2">{t("assetForm.marketManualNote")}</p>
          <label className="block text-xs text-gray-400 mb-1.5">{t("assetForm.totalValueUsd")}</label>
          <input type="number" min="0" step="0.01" value={manualValue} onChange={(e) => setManualValue(e.target.value)}
            placeholder="0.00" className={sharedInputClass} />
        </div>
      )}

      {/* Optional name + venue */}
      <div className="grid grid-cols-2 gap-3">
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder={t("assetForm.nameOptional")} className={sharedInputClass} />
        <input value={venue} onChange={(e) => setVenue(e.target.value)}
          placeholder={t("assetForm.venueOptional")} className={sharedInputClass} />
      </div>
    </div>
  );
}
