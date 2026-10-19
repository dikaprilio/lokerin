import { readFileSync } from "node:fs";
import type { BagianCv, EntriCv, IsiCv, JenisBagianCv } from "../db/schema.js";

/*
 * Templat CV Khusus (ADR 0009), meniru CV LaTeX kelas `resume` yang disukai perekrut: nama berhuruf
 * kapital di tengah, kontak dipisah ◇, judul bagian bergaris, entri dengan periode rata kanan, dan
 * poin rata kiri-kanan. Huruf CMU Serif (Computer Modern, lisensi SIL OFL) disematkan agar PDF
 * tampak sama di mana pun. Satu kolom adalah bawaan karena paling ramah ATS; editor di
 * lokerin-web memakai tata letak dan ukuran yang sama.
 */

const escape = (value: string | undefined | null) =>
  (value ?? "").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** `**tebal**` di teks CV menjadi <strong>; sisanya di-escape. */
export function kaya(value: string | undefined | null) {
  return escape(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

let hurufTersemat: string | null = null;

function huruf() {
  if (hurufTersemat !== null) return hurufTersemat;
  const berkas = [
    ["500", "normal", "cmu-serif-500-roman"],
    ["500", "italic", "cmu-serif-500-italic"],
    ["700", "normal", "cmu-serif-700-roman"],
    ["700", "italic", "cmu-serif-700-italic"],
  ] as const;
  try {
    hurufTersemat = berkas
      .map(([berat, gaya, nama]) => {
        const data = readFileSync(new URL(`./fonts/${nama}.woff2`, import.meta.url)).toString("base64");
        return `@font-face { font-family: "CMU Serif"; font-style: ${gaya}; font-weight: ${berat === "500" ? "400" : "700"}; src: url(data:font/woff2;base64,${data}) format("woff2"); }`;
      })
      .join("\n");
  } catch {
    // Tanpa berkas huruf, PDF tetap jadi dengan huruf serif cadangan.
    hurufTersemat = "";
  }
  return hurufTersemat;
}

export const CSS_CV = `
@page { size: A4; margin: 9mm 11mm 10mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #000; font-family: "CMU Serif", "Latin Modern Roman", "Times New Roman", serif; font-size: 10.5pt; line-height: 1.24; -webkit-font-smoothing: antialiased; }
a { color: #1a35c4; text-decoration: none; }
header { text-align: center; margin-bottom: 4pt; }
h1 { margin: 0; font-size: 19pt; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; }
.posisi { margin-top: 1pt; font-size: 11pt; }
.kontak { margin-top: 2pt; }
.kontak .sembunyi { font-style: italic; color: #444; }
section { margin-top: 6pt; }
h2 { margin: 0 0 3pt; padding-bottom: 1.5pt; border-bottom: 0.7pt solid #000; font-size: 11.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em; }
p { margin: 0; }
.ringkasan p, li { text-align: justify; hyphens: auto; }
.entri { margin-top: 3pt; break-inside: avoid; }
.entri:first-of-type { margin-top: 0; }
.baris { display: flex; justify-content: space-between; align-items: baseline; gap: 12pt; }
.baris .periode, .baris .lokasi { flex: none; white-space: nowrap; }
.keterangan, .lokasi { font-style: italic; }
ul { margin: 1.5pt 0 0; padding-left: 12pt; }
li { margin: 0.8pt 0; padding-left: 1pt; }
li::marker { content: "•  "; }
.keahlian { display: grid; grid-template-columns: max-content 1fr; column-gap: 16pt; row-gap: 1pt; margin: 0; }
.keahlian dt { font-weight: 700; }
.keahlian dd { margin: 0; }
.dua-kolom { display: grid; grid-template-columns: 1fr 32%; gap: 0 16pt; }
.dua-kolom .samping .keahlian { grid-template-columns: 1fr; }
.dua-kolom .samping .keahlian dd { margin-bottom: 3pt; }
`;

const URUTAN: JenisBagianCv[] = ["pengalaman", "proyek", "pendidikan", "prestasi", "lainnya"];

function entri(e: EntriCv) {
  const kiri = [
    e.judul ? `<strong>${kaya(e.judul)}</strong>` : "",
    e.tempat ? `${e.judul ? ", " : ""}${kaya(e.tempat)}` : "",
    e.keterangan ? ` <span class="keterangan">(${kaya(e.keterangan)})</span>` : "",
  ].join("");
  const kanan = e.periode ? `<span class="periode">${escape(e.periode)}</span>` : "";
  const kepala = kiri || kanan ? `<div class="baris"><span>${kiri}</span>${kanan}</div>` : "";
  const lokasi = e.lokasi ? `<div class="baris"><span></span><span class="lokasi">${escape(e.lokasi)}</span></div>` : "";
  const poin = e.poin.length ? `<ul>${e.poin.map((p) => `<li>${kaya(p.text)}</li>`).join("")}</ul>` : "";
  return `<div class="entri">${kepala}${lokasi}${poin}</div>`;
}

function bagian(b: BagianCv) {
  return `<section><h2>${escape(b.judul)}</h2>${b.entri.map(entri).join("")}</section>`;
}

function kontak(isi: IsiCv, masked: boolean) {
  const baris1 = [isi.kontak.kota, masked ? null : isi.kontak.telepon].filter(Boolean).map(escape);
  const baris2 = masked
    ? [`<span class="sembunyi">Kontak terlihat setelah Lamaran Lolos</span>`]
    : [
        isi.kontak.email ? `<a href="mailto:${escape(isi.kontak.email)}">${escape(isi.kontak.email)}</a>` : "",
        ...(isi.kontak.tautan ?? []).map((t) => `<a href="${escape(/^https?:/.test(t) ? t : `https://${t}`)}">${escape(t.replace(/^https?:\/\//, ""))}</a>`),
      ].filter(Boolean);
  return [baris1, baris2]
    .filter((baris) => baris.length)
    .map((baris) => `<div class="kontak">${baris.join(" &#9671; ")}</div>`)
    .join("");
}

/** Bagian-bagian dalam urutan baca CV: pengalaman dulu, lalu proyek, pendidikan, dan prestasi. */
export function bagianTerurut(isi: IsiCv) {
  return [...isi.bagian].sort((a, b) => URUTAN.indexOf(a.jenis) - URUTAN.indexOf(b.jenis));
}

/** Judul bagian tetap mengikuti bahasa isi CV, walaupun model menulis dalam bahasa lain dari Lowongan. */
export function bahasaCv(isi: IsiCv, cadangan: "id" | "en") {
  const judul = isi.bagian.map((b) => b.judul.toLowerCase()).join(" ");
  if (/pengalaman|pendidikan|proyek|prestasi|penghargaan/.test(judul)) return "id";
  if (/experience|education|projects?|awards?/.test(judul)) return "en";
  return cadangan;
}

export function renderCvHtml(isi: IsiCv, template: "satu_kolom" | "dua_kolom", masked: boolean, cadangan: "id" | "en" = "id") {
  const lang = bahasaCv(isi, cadangan);
  const label = lang === "en" ? { ringkasan: "Summary", keahlian: "Skills" } : { ringkasan: "Ringkasan", keahlian: "Keahlian" };
  const header = `<header>
  <h1>${escape(isi.nama)}</h1>
  ${isi.judul ? `<div class="posisi">${escape(isi.judul)}</div>` : ""}
  ${kontak(isi, masked)}
</header>`;
  const ringkasan = isi.ringkasan ? `<section class="ringkasan"><h2>${label.ringkasan}</h2><p>${kaya(isi.ringkasan)}</p></section>` : "";
  const keahlian = isi.keahlian.length
    ? `<section><h2>${label.keahlian}</h2><dl class="keahlian">${isi.keahlian
        .map((k) => `<dt>${escape(k.label)}</dt><dd>${k.isi.map(kaya).join(", ")}</dd>`)
        .join("")}</dl></section>`
    : "";
  const terurut = bagianTerurut(isi);
  const pengalaman = terurut.filter((b) => b.jenis === "pengalaman" || b.jenis === "proyek").map(bagian).join("");
  const lain = terurut.filter((b) => b.jenis !== "pengalaman" && b.jenis !== "proyek").map(bagian).join("");

  const body =
    template === "dua_kolom"
      ? `${header}<div class="dua-kolom"><main>${ringkasan}${pengalaman}${lain}</main><aside class="samping">${keahlian}</aside></div>`
      : `${header}${ringkasan}${pengalaman}${keahlian}${lain}`;

  return `<!doctype html>
<html lang="${lang}">
<head><meta charset="utf-8"><title>${escape(isi.nama)} - CV</title><style>${huruf()}\n${CSS_CV}</style></head>
<body>${body}</body>
</html>`;
}
