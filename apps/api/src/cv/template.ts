import type { IsiCv } from "../db/schema.js";

/*
 * Templat CV Khusus. Tata letak terinspirasi templat Reactive Resume
 * (https://github.com/reactive-resume/reactive-resume, MIT License,
 * Copyright (c) Amruth Pillai), ditulis ulang untuk Lokerin.
 * Satu kolom adalah bawaan karena paling ramah ATS; pada dua kolom,
 * kolom utama tetap berada lebih dulu di DOM agar urutan baca PDF benar.
 */

const escape = (value: string | undefined | null) =>
  (value ?? "").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function kontak(isi: IsiCv, masked: boolean) {
  const parts = [isi.kontak.kota];
  if (masked) parts.push("Kontak terlihat setelah Lamaran Lolos");
  else parts.push(isi.kontak.telepon, isi.kontak.email);
  return parts.filter(Boolean).map(escape).join(" · ");
}

function bagian(isi: IsiCv) {
  return isi.bagian
    .map(
      (section) => `<section>
  <h2>${escape(section.judul)}</h2>
  <ul>${section.items.map((item) => `<li>${escape(item.text)}</li>`).join("")}</ul>
</section>`,
    )
    .join("\n");
}

const baseCss = `
@page { size: A4; margin: 14mm 14mm; }
* { box-sizing: border-box; }
body { font-family: "Inter", "Helvetica Neue", Arial, sans-serif; color: #1a1a1a; font-size: 10.5pt; line-height: 1.45; margin: 0; }
h1 { font-size: 20pt; margin: 0; letter-spacing: -0.01em; }
.judul { font-size: 11.5pt; color: #444; margin-top: 2px; }
.kontak { font-size: 9.5pt; color: #555; margin-top: 4px; }
h2 { font-size: 10pt; text-transform: uppercase; letter-spacing: 0.08em; color: #0f5132; border-bottom: 1px solid #d0d7d3; padding-bottom: 2px; margin: 14px 0 6px; }
ul { margin: 0; padding-left: 16px; }
li { margin: 2px 0; }
.ringkasan { margin-top: 10px; }
.keahlian { display: flex; flex-wrap: wrap; gap: 4px 6px; padding: 0; list-style: none; }
.keahlian li { border: 1px solid #c9d3cd; border-radius: 3px; padding: 1px 6px; font-size: 9.5pt; }
`;

export function renderCvHtml(isi: IsiCv, template: "satu_kolom" | "dua_kolom", masked: boolean, lang: "id" | "en" = "id") {
  const labelRingkasan = lang === "en" ? "Summary" : "Ringkasan";
  const labelKeahlian = lang === "en" ? "Skills" : "Keahlian";
  const header = `<header>
  <h1>${escape(isi.nama)}</h1>
  <div class="judul">${escape(isi.judul)}</div>
  <div class="kontak">${kontak(isi, masked)}</div>
</header>`;
  const ringkasan = isi.ringkasan
    ? `<section class="ringkasan"><h2>${labelRingkasan}</h2><p>${escape(isi.ringkasan)}</p></section>`
    : "";
  const keahlian = isi.keahlian.length
    ? `<section><h2>${labelKeahlian}</h2><ul class="keahlian">${isi.keahlian.map((item) => `<li>${escape(item)}</li>`).join("")}</ul></section>`
    : "";

  const body =
    template === "dua_kolom"
      ? `<style>.grid { display: grid; grid-template-columns: 1fr 34%; gap: 0 18px; } .samping { order: 2; } .utama { order: 1; }</style>
${header}
<div class="grid">
  <main class="utama">${ringkasan}${bagian(isi)}</main>
  <aside class="samping">${keahlian}</aside>
</div>`
      : `${header}${ringkasan}${keahlian}${bagian(isi)}`;

  return `<!doctype html>
<html lang="${lang}">
<head><meta charset="utf-8"><title>${escape(isi.nama)} - CV</title><style>${baseCss}</style></head>
<body>${body}</body>
</html>`;
}
