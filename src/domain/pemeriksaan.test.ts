import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { periksaDraf, type DrafUntukDiperiksa } from "./pemeriksaan.js";
import { paruhWaktu, umkPerJam, upahPerJam } from "./upah.js";

const lengkap: DrafUntukDiperiksa = {
  title: "Tukang cuci piring",
  description: "Cuci piring dan peralatan masak di warung.",
  requirements: [],
  payType: "harian",
  payMin: 120_000,
  payMax: null,
  hoursPerDay: 6,
  daysPerWeek: null,
  hoursText: "16.00–22.00",
  employmentType: "harian",
  startDate: "2026-10-20",
  city: "Purwokerto",
  address: "Jl. Kampus 12",
  segment: "informal",
};

const upahRendah = (draf: Partial<DrafUntukDiperiksa>) =>
  periksaDraf({ ...lengkap, ...draf }).masalah.find((m) => m.kode === "upah_rendah");

describe("Peringatan Upah untuk kerja paruh waktu", () => {
  test("Rp30.000 untuk 17.00–22.00 diberi peringatan per jam", () => {
    const masalah = upahRendah({ payMin: 30_000, hoursPerDay: 5, hoursText: "17.00–22.00" });
    assert.ok(masalah);
    assert.equal(masalah.tingkat, "peringatan");
    assert.equal(masalah.field, "payMin");
    assert.match(masalah.pesan, /Rp6\.000 per jam/);
    assert.match(masalah.pesan, /Rp19\.640 per jam/);
    assert.match(masalah.pesan, /bukan vonis/);
  });

  test("upah paruh waktu di atas UMK dibagi 126 tidak diberi peringatan", () => {
    assert.equal(upahRendah({ payMin: 120_000, hoursPerDay: 6 }), undefined);
    assert.equal(upahRendah({ payMin: 150_000, hoursPerDay: 5, daysPerWeek: 5 }), undefined);
  });

  test("upah per jam dibandingkan langsung", () => {
    assert.ok(upahRendah({ payType: "per_jam", payMin: 10_000, hoursPerDay: 4 }));
    assert.equal(upahRendah({ payType: "per_jam", payMin: 25_000, hoursPerDay: 4 }), undefined);
  });

  test("borongan dan magang tidak dibandingkan dengan UMK", () => {
    assert.equal(upahRendah({ payType: "borongan", payMin: 10_000, hoursPerDay: 4 }), undefined);
    assert.equal(upahRendah({ segment: "magang", payMin: 10_000, hoursPerDay: 4 }), undefined);
  });

  test("jam per hari belum diisi berarti belum dinilai", () => {
    assert.equal(upahRendah({ payMin: 30_000, hoursPerDay: null }), undefined);
  });
});

describe("Peringatan Upah untuk kerja penuh waktu tetap per bulan", () => {
  test("Rp50.000 sehari, 8 jam, 6 hari diberi peringatan bulanan", () => {
    const masalah = upahRendah({ payMin: 50_000, hoursPerDay: 8, daysPerWeek: 6 });
    assert.ok(masalah);
    assert.match(masalah.pesan, /penuh waktu/);
    assert.match(masalah.pesan, /per bulan/);
  });

  test("8 jam sehari tanpa jumlah hari tidak dinilai sebagai paruh waktu", () => {
    assert.equal(upahRendah({ payMin: 100_000, hoursPerDay: 8, daysPerWeek: null }), undefined);
  });
});

describe("paruhWaktu", () => {
  test("kurang dari 7 jam sehari dan kurang dari 35 jam seminggu", () => {
    assert.equal(paruhWaktu({ ...lengkap, hoursPerDay: 5, daysPerWeek: null }), true);
    assert.equal(paruhWaktu({ ...lengkap, hoursPerDay: 6, daysPerWeek: 5 }), true);
    assert.equal(paruhWaktu({ ...lengkap, hoursPerDay: 6, daysPerWeek: 6 }), false);
    assert.equal(paruhWaktu({ ...lengkap, hoursPerDay: 7, daysPerWeek: 3 }), false);
    assert.equal(paruhWaktu({ ...lengkap, hoursPerDay: null, daysPerWeek: 3 }), false);
  });
});

describe("upahPerJam", () => {
  test("menghitung dari tiap satuan upah", () => {
    const jam = { hoursPerDay: 4, daysPerWeek: 5, payMax: null };
    assert.equal(upahPerJam({ ...jam, payType: "harian", payMin: 60_000 }), 15_000);
    assert.equal(upahPerJam({ ...jam, payType: "mingguan", payMin: 300_000 }), 15_000);
    assert.equal(Math.round(upahPerJam({ ...jam, payType: "bulanan", payMin: 1_000_000 })!), 11_547);
    assert.equal(upahPerJam({ ...jam, payType: "mingguan", payMin: 300_000, daysPerWeek: null }), null);
  });

  test("UMK dibagi 126", () => {
    assert.equal(umkPerJam({ umk_bulanan: 2_520_000 }), 20_000);
  });
});
