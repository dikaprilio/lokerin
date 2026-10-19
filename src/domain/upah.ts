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

/**
 * Kerja paruh waktu menurut penjelasan PP 36/2021 Pasal 16: kurang dari 7 jam sehari dan kurang dari
 * 35 jam seminggu. Bila hari per minggu belum disebut, jam per hari saja yang menentukan.
 */
export function paruhWaktu(upah: Upah) {
  const jam = upah.hoursPerDay;
  if (!jam || jam >= 7) return false;
  return !upah.daysPerWeek || jam * upah.daysPerWeek < 35;
}

/** Upah per jam dari upah minimal dan jam kerja di Lowongan; null bila jamnya belum cukup untuk menghitung. */
export function upahPerJam(upah: Upah): number | null {
  const { payMin: amount, hoursPerDay: jam, daysPerWeek: hari } = upah;
  if (!amount || !upah.payType) return null;
  switch (upah.payType) {
    case "per_jam":
      return amount;
    case "harian":
      return jam ? amount / jam : null;
    case "mingguan":
      return jam && hari ? amount / (jam * hari) : null;
    case "bulanan":
      return jam && hari ? amount / (jam * hari * WEEKS_PER_MONTH) : null;
    case "borongan":
      return null;
  }
}

/** Upah per jam terendah untuk pekerja paruh waktu: upah sebulan dibagi 126 (PP 36/2021 Pasal 16). */
export function umkPerJam(acuan: Pick<AcuanUpah, "umk_bulanan">) {
  return acuan.umk_bulanan / 126;
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
