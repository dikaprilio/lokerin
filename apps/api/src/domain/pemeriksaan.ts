import type { HasilPemeriksaan, JenisUpah } from "../db/schema.js";
import { acuanUpah, formatRupiah, penuhWaktu, perkiraanBulanan } from "./upah.js";

export type DrafUntukDiperiksa = {
  title: string | null;
  description: string | null;
  requirements: string[] | null;
  payType: JenisUpah | null;
  payMin: number | null;
  payMax: number | null;
  hoursPerDay: number | null;
  daysPerWeek: number | null;
  hoursText: string | null;
  employmentType: string | null;
  startDate: string | null;
  city: string | null;
  address: string | null;
  segment: "informal" | "magang";
};

/** Pola permintaan biaya dari pelamar: alasan paling umum lowongan palsu. */
const POLA_BIAYA = [
  /biaya\s+(pendaftaran|administrasi|admin|pelatihan|training|seragam|medical|tes|registrasi)/i,
  /uang\s+(pendaftaran|seragam|jaminan|deposit|administrasi|pelatihan)/i,
  /(bayar|transfer|setor)\s+(dulu|terlebih\s+dahulu|di\s*muka|sebesar)/i,
  /deposit\s+(awal|rp)/i,
  /dp\s+rp/i,
  /(registration|training|uniform)\s+fee/i,
];

type Masalah = HasilPemeriksaan["masalah"][number];

export function periksaDraf(draf: DrafUntukDiperiksa): HasilPemeriksaan {
  const masalah: Masalah[] = [];
  const tahan = (kode: string, pesan: string, field?: string) =>
    masalah.push({ kode, tingkat: "tahan", pesan, ...(field ? { field } : {}) });
  const peringatan = (kode: string, pesan: string, field?: string) =>
    masalah.push({ kode, tingkat: "peringatan", pesan, ...(field ? { field } : {}) });

  if (!draf.title?.trim()) tahan("judul_kosong", "Posisi yang dicari belum disebutkan.", "title");
  if (!draf.city?.trim()) tahan("lokasi_kosong", "Kota atau kecamatan tempat kerja belum disebutkan.", "city");
  if (!draf.payMin || !draf.payType) tahan("upah_kosong", "Besar upah dan satuannya (per hari, per bulan, dll.) belum disebutkan.", "payMin");
  if (!draf.hoursText?.trim() && !draf.hoursPerDay)
    tahan("jam_kosong", "Jam kerja belum disebutkan.", "hoursText");
  if (!draf.employmentType?.trim())
    tahan("jenis_kosong", "Jenis hubungan kerja (harian, paruh waktu, kontrak, tetap, magang) belum disebutkan.", "employmentType");
  if (!draf.startDate) peringatan("mulai_kosong", "Tanggal mulai kerja belum disebutkan.", "startDate");
  if (!draf.address?.trim()) peringatan("alamat_kosong", "Alamat atau patokan lokasi belum ada; pelamar sulit menilai jarak.", "address");
  if (draf.payMin && draf.payMax && draf.payMax < draf.payMin)
    tahan("upah_terbalik", "Upah maksimal lebih kecil dari upah minimal.", "payMax");

  const teks = [draf.title, draf.description, ...(draf.requirements ?? [])].filter(Boolean).join("\n");
  if (POLA_BIAYA.some((pola) => pola.test(teks))) {
    tahan(
      "minta_biaya",
      "Lowongan meminta biaya dari pelamar. Lokerin tidak menerbitkan lowongan yang memungut biaya pendaftaran, seragam, pelatihan, atau deposit.",
      "description",
    );
  }

  const acuan = acuanUpah();
  const bulanan = perkiraanBulanan(draf);
  if (acuan && bulanan && draf.segment === "informal") {
    if (penuhWaktu(draf) && bulanan < acuan.umk_bulanan) {
      peringatan(
        "upah_rendah",
        `Untuk kerja penuh waktu, upah ini setara sekitar ${formatRupiah(bulanan)} per bulan, di bawah UMK ${acuan.kabupaten} ${acuan.tahun} (${formatRupiah(acuan.umk_bulanan)}). Usaha mikro dan kecil punya ketentuan upah sendiri, jadi ini bukan vonis. Mohon pastikan jam kerja, makan, atau tunjangan lain sudah ditulis, atau sesuaikan upahnya.`,
        "payMin",
      );
    }
    const tertinggi = perkiraanBulanan(draf, "max");
    if (tertinggi && tertinggi > acuan.umk_bulanan * 4) {
      peringatan(
        "upah_tidak_wajar",
        "Upah jauh di atas kebiasaan untuk pekerjaan sejenis. Lowongan seperti ini sering dipakai untuk penipuan; pastikan angkanya benar.",
        "payMax",
      );
    }
  }

  return {
    boleh_terbit: !masalah.some((item) => item.tingkat === "tahan"),
    masalah,
    diperiksa_pada: new Date().toISOString(),
  };
}
