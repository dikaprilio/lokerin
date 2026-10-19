/** Tanggal hari ini (YYYY-MM-DD) menurut kalender WIB. */
export function hariIniWib(sekarang = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(sekarang);
}

type Jam = { jam: number; menit: number };

/** Jam mulai dan selesai dari teks jam kerja seperti "17.00–22.00", "07:00 - 15:00", atau "08.00 s.d. 16.00". */
export function jamDariTeks(teks: string | null | undefined): { mulai: Jam; selesai: Jam } | null {
  const cocok = teks?.match(/(\d{1,2})[.:](\d{2})\s*(?:–|—|-|s\.?\s?d\.?|sampai|hingga)\s*(\d{1,2})[.:](\d{2})/i);
  if (!cocok) return null;
  const [mulaiJam, mulaiMenit, selesaiJam, selesaiMenit] = cocok.slice(1).map(Number) as [number, number, number, number];
  if (mulaiJam > 23 || selesaiJam > 24 || mulaiMenit > 59 || selesaiMenit > 59) return null;
  return { mulai: { jam: mulaiJam, menit: mulaiMenit }, selesai: { jam: selesaiJam, menit: selesaiMenit } };
}

/**
 * Batas Butuh Hari Ini untuk Lowongan yang mulai hari ini: sampai jam kerjanya dimulai, atau sampai
 * jam kerjanya selesai bila sudah dimulai. Jam kerja yang tidak terbaca berarti sampai akhir hari.
 * Null bila tidak mulai hari ini atau jam kerjanya sudah selesai.
 */
export function batasButuhHariIni(startDate: string | null | undefined, hoursText: string | null | undefined, sekarang = new Date()) {
  const hariIni = hariIniWib(sekarang);
  if (startDate?.slice(0, 10) !== hariIni) return null;
  const [tahun, bulan, tanggal] = hariIni.split("-").map(Number) as [number, number, number];
  const pada = ({ jam, menit }: Jam) => new Date(Date.UTC(tahun, bulan - 1, tanggal, jam - 7, menit));
  const lewat = (batas: Date) => (batas > sekarang ? batas : null);

  const jam = jamDariTeks(hoursText);
  if (!jam) return lewat(pada({ jam: 23, menit: 59 }));
  const mulai = pada(jam.mulai);
  if (mulai > sekarang) return mulai;
  const selesai = pada(jam.selesai);
  // Shift malam seperti 22.00–06.00 selesai besok paginya.
  if (selesai <= mulai) selesai.setUTCDate(selesai.getUTCDate() + 1);
  return lewat(selesai);
}
