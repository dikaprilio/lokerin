import type { employers, fakta, lamaran, lowongan, personas, tahapBerikutnya, users } from "../db/schema.js";
import { labelUpah, perkiraanBulanan } from "./upah.js";

type Lowongan = typeof lowongan.$inferSelect;
type Employer = typeof employers.$inferSelect;
type User = typeof users.$inferSelect;

export function kartuPemberiKerja(employer: Employer) {
  const dicek: string[] = [];
  if (employer.checks.ktp) dicek.push("KTP");
  if (employer.checks.npwp) dicek.push("NPWP");
  if (employer.checks.foto_usaha) dicek.push("Foto usaha");
  return {
    id: employer.id,
    nama_usaha: employer.businessName,
    jenis: employer.kind,
    kota: employer.city,
    kecamatan: employer.district,
    terverifikasi: employer.status === "terverifikasi",
    status_verifikasi: employer.status,
    yang_dicek: dicek,
    diverifikasi_pada: employer.verifiedAt?.toISOString() ?? null,
  };
}

export function kartuLowongan(row: Lowongan, employer: Employer, extra: Record<string, unknown> = {}) {
  return {
    id: row.id,
    judul: row.title,
    kategori: row.category,
    segmen: row.segment,
    deskripsi: row.description,
    syarat: row.requirements,
    upah: {
      label: labelUpah(row),
      jenis: row.payType,
      min: row.payMin,
      max: row.payMax,
      perkiraan_bulanan: perkiraanBulanan(row),
    },
    jam_kerja: row.hoursText,
    jam_per_hari: row.hoursPerDay,
    hari_per_minggu: row.daysPerWeek,
    jenis_kerja: row.employmentType,
    mulai: row.startDate,
    lokasi: { kota: row.city, kecamatan: row.district, alamat: row.address, lat: row.lat, lng: row.lng },
    butuh_hari_ini: row.urgentUntil && row.urgentUntil.getTime() > Date.now() ? row.urgentUntil.toISOString() : null,
    bahasa: row.language,
    status: row.status,
    pemeriksaan: row.pemeriksaan,
    diterbitkan_pada: row.publishedAt?.toISOString() ?? null,
    pemberi_kerja: kartuPemberiKerja(employer),
    ...extra,
  };
}

export function kartuFakta(row: typeof fakta.$inferSelect) {
  return {
    id: row.id,
    jenis: row.kind,
    judul: row.title,
    detail: row.detail,
    tempat: row.place,
    periode: row.period,
    status: row.status,
    sumber: row.source,
  };
}

export function kartuPersona(row: typeof personas.$inferSelect) {
  return {
    id: row.id,
    judul: row.title,
    ringkasan: row.summary,
    keahlian: row.skills,
    fakta_ids: row.faktaIds,
    preferensi: row.preferensi,
  };
}

/** Kontak Pencari Kerja hanya terlihat oleh Pemberi Kerja setelah Lamaran Lolos. */
export function kartuLamaran(
  row: typeof lamaran.$inferSelect,
  options: {
    pencari: User;
    persona: typeof personas.$inferSelect;
    lowongan: Lowongan;
    employer: Employer;
    tahap: (typeof tahapBerikutnya.$inferSelect)[];
    untuk: "pencari" | "pemberi";
  },
) {
  const kontakTerbuka = options.untuk === "pencari" || row.status === "lolos";
  return {
    id: row.id,
    status: row.status,
    pesan: row.pesan,
    dikirim_pada: row.createdAt.toISOString(),
    dilihat_pada: row.seenAt?.toISOString() ?? null,
    diputuskan_pada: row.decidedAt?.toISOString() ?? null,
    cv_khusus_id: row.cvKhususId,
    pencari: {
      id: options.pencari.id,
      nama: options.pencari.name,
      kota: options.pencari.city,
      telepon: kontakTerbuka ? options.pencari.phone : null,
      email: kontakTerbuka ? options.pencari.email : null,
      kontak_disembunyikan: !kontakTerbuka,
    },
    persona: kartuPersona(options.persona),
    lowongan: { id: options.lowongan.id, judul: options.lowongan.title, kota: options.lowongan.city },
    pemberi_kerja: kartuPemberiKerja(options.employer),
    tahap_berikutnya: options.tahap.map((tahap) => ({
      id: tahap.id,
      jenis: tahap.kind,
      detail: tahap.detail,
      jadwal: tahap.scheduledAt?.toISOString() ?? null,
      catatan: tahap.note,
    })),
  };
}
