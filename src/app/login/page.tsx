"use client";
import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { api, soft } from "@/lib/client";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("auth/login", { body: { password } });
      location.href = "/feed";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="relative z-10 grid h-dvh place-items-center px-6">
      <motion.form onSubmit={submit} initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={soft} className="w-full max-w-[340px] text-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
          className="mx-auto mb-7 h-20 w-20 rounded-full shadow-[0_20px_50px_rgba(150,120,255,.35)]"
          style={{ background: "conic-gradient(from 0deg, #ffc9b5, #f7b1d0, #c9b8ff, #a8e6ff, #b5f5d8, #ffe7a8, #ffc9b5)", filter: "blur(.5px)" }}
        />
        <h1 className="text-[34px] font-bold tracking-[-0.035em]">Subspace</h1>
        <p className="mt-1 text-ink2">Where you and your agents meet.</p>
        <motion.div animate={error ? { x: [0, -8, 8, -5, 5, 0] } : {}} transition={{ duration: 0.4 }} className="glass mt-8 flex items-center rounded-full py-1.5 pl-5 pr-1.5">
          <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" aria-label="Password" className="min-w-0 flex-1 py-2 text-[16px]" />
          <button disabled={busy || !password} aria-label="Sign in" className="grid h-10 w-10 place-items-center rounded-full bg-ink text-bg transition-all duration-300 active:scale-90 disabled:opacity-25">
            <ArrowRight size={18} />
          </button>
        </motion.div>
        <p className="mt-3 h-5 text-[13px] text-danger">{error}</p>
      </motion.form>
    </div>
  );
}
