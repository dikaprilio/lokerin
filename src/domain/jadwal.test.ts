import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { batasButuhHariIni, hariIniWib, jamDariTeks } from "./jadwal.js";

const wib = (waktu: string) => new Date(`${waktu}+07:00`);

describe("hariIniWib", () => {
  test("memakai kalender WIB, bukan UTC", () => {
    assert.equal(hariIniWib(wib("2026-10-20T06:30:00")), "2026-10-20");
    assert.equal(hariIniWib(wib("2026-10-19T23:30:00")), "2026-10-19");
  });
});

describe("jamDariTeks", () => {
  test("membaca beberapa cara menulis jam kerja", () => {
    assert.deepEqual(jamDariTeks("17.00–22.00"), { mulai: { jam: 17, menit: 0 }, selesai: { jam: 22, menit: 0 } });
    assert.deepEqual(jamDariTeks("07:30 - 15:00"), { mulai: { jam: 7, menit: 30 }, selesai: { jam: 15, menit: 0 } });
    assert.deepEqual(jamDariTeks("08.00 s.d. 16.00"), { mulai: { jam: 8, menit: 0 }, selesai: { jam: 16, menit: 0 } });
    assert.deepEqual(jamDariTeks("Shift malam 22.00 sampai 06.00"), { mulai: { jam: 22, menit: 0 }, selesai: { jam: 6, menit: 0 } });
  });

  test("teks tanpa jam yang jelas", () => {
    assert.equal(jamDariTeks("malam"), null);
    assert.equal(jamDariTeks(null), null);
    assert.equal(jamDariTeks("25.00–26.00"), null);
  });
});

describe("batasButuhHariIni", () => {
  test("mulai hari ini: sampai jam kerja dimulai", () => {
    const batas = batasButuhHariIni("2026-10-19", "17.00–22.00", wib("2026-10-19T14:00:00"));
    assert.deepEqual(batas, wib("2026-10-19T17:00:00"));
  });

  test("jam kerja sudah dimulai: sampai jam kerja selesai", () => {
    const batas = batasButuhHariIni("2026-10-19", "17.00–22.00", wib("2026-10-19T18:00:00"));
    assert.deepEqual(batas, wib("2026-10-19T22:00:00"));
  });

  test("shift malam yang lewat tengah malam", () => {
    const batas = batasButuhHariIni("2026-10-19", "22.00–06.00", wib("2026-10-19T23:00:00"));
    assert.deepEqual(batas, wib("2026-10-20T06:00:00"));
  });

  test("jam kerja tidak terbaca: sampai akhir hari", () => {
    const batas = batasButuhHariIni("2026-10-19", "malam", wib("2026-10-19T14:00:00"));
    assert.deepEqual(batas, wib("2026-10-19T23:59:00"));
  });

  test("tidak mulai hari ini, atau jam kerjanya sudah selesai", () => {
    assert.equal(batasButuhHariIni("2026-10-20", "17.00–22.00", wib("2026-10-19T14:00:00")), null);
    assert.equal(batasButuhHariIni(null, "17.00–22.00", wib("2026-10-19T14:00:00")), null);
    assert.equal(batasButuhHariIni("2026-10-19", "07.00–15.00", wib("2026-10-19T16:00:00")), null);
  });
});
