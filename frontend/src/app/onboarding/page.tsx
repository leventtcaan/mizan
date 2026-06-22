"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredUser, setStoredUser, uploadStatement, completeOnboarding, type UploadResponse } from "@/lib/api";
import { FileText, ArrowRight } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";

type Step = 1 | 2 | 3;

export default function OnboardingPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [institutionName, setInstitutionName] = useState("");
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
      setUploadError(err instanceof Error ? err.message : t("common.error"));
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
  const stepLabels = [t("onboarding.stepSource"), t("onboarding.stepInstructions"), t("onboarding.stepUpload")];
  const instructions = t("onboarding.step2Instructions") as unknown as string[];

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
            {stepLabels.map((label, i) => (
              <span key={i} className={`text-xs ${step > i ? "text-indigo-400" : "text-gray-700"}`}>
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Step 1: Source select */}
        {step === 1 && (
          <div>
            <h1 className="text-3xl font-bold mb-2">{t("onboarding.welcome")}</h1>
            {userEmail && <p className="text-gray-500 text-sm mb-6">{userEmail}</p>}
            <p className="text-gray-300 mb-6">{t("onboarding.step1CTA")}</p>

            <div className="mb-8">
              <label className="block text-xs text-gray-500 mb-2 uppercase tracking-wide">
                {t("onboarding.step1Label")}
              </label>
              <input
                value={institutionName}
                onChange={(e) => setInstitutionName(e.target.value)}
                placeholder={t("onboarding.step1Placeholder")}
                className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600"
              />
              <p className="text-gray-600 text-xs mt-2">
                {t("common.optional")}
              </p>
            </div>

            <button
              onClick={() => setStep(2)}
              className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {t("onboarding.continue")} <ArrowRight size={18} />
            </button>
          </div>
        )}

        {/* Step 2: Instructions */}
        {step === 2 && (
          <div>
            <h2 className="text-2xl font-bold mb-2">{t("onboarding.step2Title")}</h2>
            <p className="text-gray-500 text-sm mb-8">
              {institutionName.trim() || t("onboarding.step1Subtitle")}
            </p>

            <div className="space-y-3 mb-8">
              {Array.isArray(instructions) && instructions.map((instruction, i) => (
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
                <span className="text-gray-300 font-medium">{t("onboarding.tipLabel")} </span>
                {t("onboarding.tipText")}
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="flex-1 py-3.5 rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] hover:bg-[#2A2A2A] font-semibold transition-colors text-gray-300"
              >
                ← {t("common.back")}
              </button>
              <button
                onClick={() => setStep(3)}
                className="flex-[2] py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {t("onboarding.continue")} <ArrowRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Upload */}
        {step === 3 && (
          <div>
            <h2 className="text-2xl font-bold mb-2">{t("onboarding.step3Title")}</h2>
            <p className="text-gray-500 text-sm mb-8">{t("onboarding.step3Subtitle")}</p>

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
                      <p className="text-gray-400 text-sm">{t("onboarding.uploading")}</p>
                    </div>
                  ) : (
                    <div>
                      <div className="w-12 h-12 rounded-xl bg-[#2A2A2A] flex items-center justify-center mx-auto mb-3">
                        <FileText size={22} className="text-gray-400" />
                      </div>
                      <p className="text-gray-300 font-medium mb-1">{t("onboarding.dropHere")}</p>
                      <p className="text-gray-600 text-sm">{t("onboarding.orClick")}</p>
                      <p className="text-gray-700 text-xs mt-3">{t("onboarding.pdfCsvMax")}</p>
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
                    ← {t("common.back")}
                  </button>
                  <button
                    onClick={handleSkip}
                    className="flex-1 py-3.5 rounded-xl border border-[#2A2A2A] hover:border-[#3A3A3A] font-semibold transition-colors text-gray-500 hover:text-gray-300 text-sm"
                  >
                    {t("onboarding.skip")}
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
                    {uploadResult.transaction_count} {t("onboarding.uploadSuccess")}
                  </h3>
                  <p className="text-gray-500 text-sm">{t("onboarding.analysisSuccess")}</p>
                </div>
                <button
                  onClick={handleFinish}
                  className="w-full py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  {t("onboarding.finish")} <ArrowRight size={18} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
