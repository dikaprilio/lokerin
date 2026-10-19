import { randomUUID } from "node:crypto";
import type { BagianCv, IsiCv, IsiCvLama, JenisBagianCv } from "../db/schema.js";

function jenisDari(judul: string): JenisBagianCv {
  const j = judul.toLowerCase();
  if (/pendidikan|education|sekolah/.test(j)) return "pendidikan";
  if (/proyek|project|portofolio/.test(j)) return "proyek";
  if (/prestasi|penghargaan|award|sertifikat/.test(j)) return "prestasi";
  if (/pengalaman|experience|kerja/.test(j)) return "pengalaman";
  return "lainnya";
}

/**
 * CV Khusus yang dibuat sebelum ADR 0009 menyimpan bagian sebagai daftar kalimat. Bentuk itu diubah
 * ke versi 2 saat dibaca: tiap bagian menjadi satu Entri tanpa judul berisi poin yang sama.
 */
export function normalisasiIsi(isi: IsiCv | IsiCvLama): IsiCv {
  if ("versi" in isi && isi.versi === 2) return isi;
  const lama = isi as IsiCvLama;
  const bagian: BagianCv[] = lama.bagian.map((section) => ({
    id: section.id,
    judul: section.judul,
    jenis: jenisDari(section.judul),
    entri: section.items.length
      ? [
          {
            id: `${section.id}-entri`,
            judul: "",
            poin: section.items.map((item) => ({ ...item, fakta_ids: item.fakta_ids ?? [] })),
            fakta_ids: [...new Set(section.items.flatMap((item) => item.fakta_ids ?? []))],
          },
        ]
      : [],
  }));
  return {
    versi: 2,
    nama: lama.nama,
    judul: lama.judul,
    kontak: lama.kontak,
    ringkasan: lama.ringkasan,
    keahlian: lama.keahlian.length ? [{ id: randomUUID(), label: "Keahlian", isi: lama.keahlian }] : [],
    bagian,
  };
}

/** Semua teks yang bisa diedit pengguna, per id, untuk menandai edit dan calon Fakta. */
export function teksPerId(isi: IsiCv) {
  const peta = new Map<string, string>();
  for (const section of isi.bagian) {
    for (const entri of section.entri) {
      peta.set(entri.id, [entri.judul, entri.tempat, entri.periode].filter(Boolean).join(" | "));
      for (const poin of entri.poin) peta.set(poin.id, poin.text);
    }
  }
  return peta;
}
