import { readFileSync } from "node:fs";
import type { JenisUpah } from "../db/schema.js";

export type AcuanUpah = {
  kabupaten: string;
  tahun: number;
  umk_bulanan: number;
  sumber_judul: string;
  sumber_url: string;
};

let cached: AcuanUpah | null | undefined;

/** UMK acuan dari data seed (lihat src/seed/data/upah.json beserta sumbernya). */
export function acuanUpah(): AcuanUpah | null {
  if (cached !== undefined) return cached;
  try {
    const raw = readFileSync(new URL("../seed/data/upah.json", import.meta.url), "utf8");
    cached = JSON.parse(raw) as AcuanUpah;
  } catch {
    cached = null;
  }
  return cached;
}

type Upah = {
  payType: JenisUpah | null;
  payMin: number | null;
  payMax: number | null;
  hoursPerDay: number | null;
  daysPerWeek: number | null;
};

const WEEKS_PER_MONTH = 4.33;

/** Perkiraan upah per bulan bila dikerjakan penuh sesuai jam dan hari kerja di Lowongan. */
export function perkiraanBulanan(upah: Upah, which: "min" | "max" = "min"): number | null {
  const amount = which === "min" ? upah.payMin : (upah.payMax ?? upah.payMin);
  if (!amount || !upah.payType) return null;
  const days = upah.daysPerWeek ?? 6;
  const hours = upah.hoursPerDay ?? 8;
  switch (upah.payType) {
    case "bulanan":
      return amount;
    case "mingguan":
      return Math.round(amount * WEEKS_PER_MONTH);
    case "harian":
      return Math.round(amount * days * WEEKS_PER_MONTH);
    case "per_jam":
      return Math.round(amount * hours * days * WEEKS_PER_MONTH);
    case "borongan":
      return null;
  }
}

export function penuhWaktu(upah: Upah) {
  return (upah.hoursPerDay ?? 0) * (upah.daysPerWeek ?? 0) >= 35;
}

export function formatRupiah(value: number) {
  return `Rp${Math.round(value).toLocaleString("id-ID")}`;
}

export function labelUpah(upah: Upah) {
  if (!upah.payMin || !upah.payType) return "Upah belum diisi";
  const satuan: Record<JenisUpah, string> = {
    harian: "/hari",
    mingguan: "/minggu",
    bulanan: "/bulan",
    borongan: " borongan",
    per_jam: "/jam",
  };
  const range =
    upah.payMax && upah.payMax !== upah.payMin
      ? `${formatRupiah(upah.payMin)}–${formatRupiah(upah.payMax)}`
      : formatRupiah(upah.payMin);
  return `${range}${satuan[upah.payType]}`;
}
