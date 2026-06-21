"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredUser, setStoredUser, uploadStatement, completeOnboarding, type UploadResponse } from "@/lib/api";
import { FileText, ArrowRight } from "@/components/ui/Icons";

type Bank = "ziraat" | "vakifbank" | "yapikredi" | "garanti" | "diger";
type Step = 1 | 2 | 3;

const BANK_LABELS: Record<Bank, string> = {
  ziraat: "Ziraat Bankası",
  vakifbank: "VakıfBank",
  yapikredi: "Yapı Kredi",
  garanti: "Garanti BBVA",
  diger: "Diğer",
};

const BANK_INSTRUCTIONS: Record<Bank, string[]> = {
  ziraat: [
    "Ziraat Mobil uygulamasını açın",
    'Altta "Hesaplarım" sekmesine gidin',
    '"Hesap Hareketleri"ni seçin',
    'Sağ üstten "PDF İndir"e basın',
    "Son 3 aylık dönemi seçip indirin",
  ],
  vakifbank: [
    "VakıfBank Mobil uygulamasını açın",
    '"Hesaplarım" bölümüne gidin',
    '"Hesap Hareketleri"ni seçin',
    '"Dışa Aktar" butonuna basın',
    "PDF formatını seçip indirin",
  ],
  yapikredi: [
    "Yapı Kredi Mobil uygulamasını açın",
    '"Hesaplarım"a gidin',
    '"Ekstre" sekmesini açın',
    '"PDF" formatını seçin',
    "Son 3 aylık ekstre indirin",
  ],
  garanti: [
    "Garanti BBVA Mobil uygulamasını açın",
    '"Hesaplarım" bölümüne gidin',
    '"Ekstre"yi seçin',
    '"İndir" butonuna basın',
    "PDF olarak kaydedin",
  ],
  diger: [
    "Bankanızın mobil uygulamasını açın",
    "Hesap hareketleri veya ekstre bölümüne gidin",
    "Son 3 aylık dönemi seçin",
    "PDF olarak indirin",
    "İndirdiğiniz dosyayı aşağıya yükleyin",
  ],
};

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [bank, setBank] = useState<Bank>("ziraat");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const user = getStoredUser();
    if (!user) { router.replace("/login"); return; }
    setUserEmail(user.email);
    if (user.onboarding_completed) router.replace("/transactions");
  }, [router]);

  const handleFile = async (file: File) => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const result = await uploadStatement(file);
      setUploadResult(result);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Yükleme başarısız oldu.");
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleFinish = async () => {
    try {
      await completeOnboarding();
      const user = getStoredUser();
      if (user) setStoredUser({ ...user, onboarding_completed: true });
    } catch {}
    router.push("/transactions");
  };

  const handleSkip = async () => {
    try {
      await completeOnboarding();
      const user = getStoredUser();
      if (user) setStoredUser({ ...user, onboarding_completed: true });
    } catch {}
    router.push("/transactions");
  };

  const progressPct = step === 1 ? 33 : step === 2 ? 66 : 100;

  return (
    <div className="min-h-screen bg-[#0F0F0F] text-white flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">

        {/* Logo + progress */}
        <div className="mb-10">
          <p className="text-center text-gray-600 text-sm mb-5 font-medium tracking-widest uppercase">Mizan</p>
          <div className="w-full h-0.5 bg-[#2A2A2A] rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex justify-between mt-2">
            {[1,2,3].map(n => (
              <span key={n} className={`text-xs ${step >= n ? "text-indigo-400" : "text-gray-700"}`}>
                {n === 1 ? "Banka" : n === 2 ? "Talimatlar" : "Yükleme"}
              </span>
            ))}
          </div>
        </div>

        {/* Step 1: Bank select */}
        {step === 1 && (
          <div>
            <h1 className="text-3xl font-bold mb-2">Hoş geldiniz</h1>
            {userEmail && <p className="text-gray-500 text-sm mb-6">{userEmail}</p>}
            <p className="text-gray-300 mb-8">Hangi bankanızla başlamak istersiniz?</p>

            <div className="grid grid-cols-2 gap-3 mb-8 sm:grid-cols-3">
              {(Object.entries(BANK_LABELS) as [Bank, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setBank(key)}
                  className={`py-3 px-4 rounded-xl border text-sm font-medium transition-all text-left ${
                    bank === key
                      ? "bg-indigo-950 border-indigo-600 text-indigo-200"
                      : "bg-[#1A1A1A] border-[#2A2A2A] text-gray-300 hover:border-[#3A3A3A]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setStep(2)}
              className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold transition-colors flex items-center justify-center gap-2"
            >
              İleri <ArrowRight size={18} />
            </button>
          </div>
        )}

        {/* Step 2: Instructions */}
        {step === 2 && (
          <div>
            <h2 className="text-2xl font-bold mb-2">Ekstreyi nasıl indirirsiniz?</h2>
            <p className="text-gray-500 text-sm mb-8">{BANK_LABELS[bank]} için adım adım</p>

            <div className="space-y-3 mb-8">
              {BANK_INSTRUCTIONS[bank].map((instruction, i) => (
                <div key={i} className="flex items-start gap-4 p-4 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl">
                  <span className="w-6 h-6 rounded-full bg-indigo-950 border border-indigo-800 text-indigo-400 text-xs font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <p className="text-gray-300 text-sm leading-relaxed">{instruction}</p>
                </div>
              ))}
            </div>

            <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4 mb-8">
              <p className="text-gray-400 text-xs leading-relaxed">
                <span className="text-gray-300 font-medium">İpucu: </span>
                Son 3 aylık ekstre yüklediğinizde daha iyi bir analiz alırsınız. PDF veya CSV desteklenir.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="flex-1 py-3.5 rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] hover:bg-[#2A2A2A] font-semibold transition-colors text-gray-300"
              >
                ← Geri
              </button>
              <button
                onClick={() => setStep(3)}
                className="flex-[2] py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold transition-colors flex items-center justify-center gap-2"
              >
                İleri <ArrowRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Upload */}
        {step === 3 && (
          <div>
            <h2 className="text-2xl font-bold mb-2">Ekstrenizi yükleyin</h2>
            <p className="text-gray-500 text-sm mb-8">ve analize başlayalım</p>

            {!uploadResult ? (
              <>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all mb-5 ${
                    dragging
                      ? "border-indigo-500 bg-indigo-950/20"
                      : "border-[#2A2A2A] hover:border-[#3A3A3A] bg-[#1A1A1A]"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.csv"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                  />
                  {uploading ? (
                    <div>
                      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                      <p className="text-gray-400 text-sm">Yükleniyor ve analiz ediliyor...</p>
                    </div>
                  ) : (
                    <div>
                      <div className="w-12 h-12 rounded-xl bg-[#2A2A2A] flex items-center justify-center mx-auto mb-3">
                        <FileText size={22} className="text-gray-400" />
                      </div>
                      <p className="text-gray-300 font-medium mb-1">Dosyayı buraya sürükleyin</p>
                      <p className="text-gray-600 text-sm">veya tıklayarak seçin</p>
                      <p className="text-gray-700 text-xs mt-3">PDF veya CSV · Maks 10 MB</p>
                    </div>
                  )}
                </div>

                {uploadError && (
                  <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/40 mb-4">
                    <p className="text-red-400 text-sm">{uploadError}</p>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => setStep(2)}
                    className="flex-1 py-3.5 rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] hover:bg-[#2A2A2A] font-semibold transition-colors text-gray-300"
                  >
                    ← Geri
                  </button>
                  <button
                    onClick={handleSkip}
                    className="flex-1 py-3.5 rounded-xl border border-[#2A2A2A] hover:border-[#3A3A3A] font-semibold transition-colors text-gray-500 hover:text-gray-300 text-sm"
                  >
                    Şimdi değil, atla
                  </button>
                </div>
              </>
            ) : (
              <div>
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-emerald-950 border border-emerald-800 flex items-center justify-center mx-auto mb-4">
                    <span className="text-emerald-400 text-2xl">✓</span>
                  </div>
                  <h3 className="text-xl font-semibold text-emerald-300 mb-2">
                    {uploadResult.transaction_count} işlem bulundu
                  </h3>
                  <p className="text-gray-500 text-sm">Ekstreniniz başarıyla analiz edildi.</p>
                </div>
                <button
                  onClick={handleFinish}
                  className="w-full py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  Hadi Başlayalım <ArrowRight size={18} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
