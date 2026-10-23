/* =====================================================================
   arena-data.js — LAPISAN DATA (state) untuk Arena 1 & Arena 2
   ---------------------------------------------------------------------
   PROTOTYPE FRONTEND: data disimpan di localStorage browser ini saja.
   localStorage TIDAK tersinkron antar perangkat / antar browser.
   Nanti, ganti isi load()/save()/update() dengan fetch() ke API PHP+MySQL;
   halaman lain cukup memakai API ATSC.* yang sama.
   Setiap arena = objek terpisah (state.arenas[1], state.arenas[2]).
   ===================================================================== */
const ATSC = (() => {
    'use strict';
    const KEY = 'atsc4.state.v4'; // v4: hukuman T1 T2 P1 P2 + DIS, kategori usia+gender

    /* ---- ATURAN PROTOTYPE (EDIT SESUAI REGLEMEN RESMI) --------------------
       Nilai di bawah adalah PLACEHOLDER konfigurasi, bukan aturan resmi
       Tapak Suci. Ubah di sini tanpa menyentuh bagian lain.               */
    const RULES = {
        judgeCount: 4,
        // 4 tombol nilai pada remot juri (sesuai gambar remot): label = kode di tombol,
        // show = teks nilai besar, pts = poin. GANTI sesuai reglemen resmi.
        techButtons: [
            { label: 'T+S', show: '10+', pts: 10 }, { label: 'S.T', show: '20', pts: 20 },
            { label: 'S.K', show: '30', pts: 30 }, { label: 'S.J', show: '40', pts: 40 }
        ],
        // Tombol bawah remot: T1 -10, T2 -20, P1 -30, P2 -40 (dijumlahkan bila beberapa aktif). DIS = diskualifikasi
        // (hanya bisa ditekan setelah P2). pts = pengurang skor saat sah (angka negatif).
        penaltyBtns: [
            { key: 't', idx: 0, label: 'T1', name: 'Teguran 1', pts: -10 },
            { key: 't', idx: 1, label: 'T2', name: 'Teguran 2', pts: -20 },
            { key: 'p', idx: 0, label: 'P1', name: 'Peringatan 1', pts: -30 },
            { key: 'p', idx: 1, label: 'P2', name: 'Peringatan 2', pts: -40 },
            { key: 'dis', idx: 0, label: 'DIS', name: 'Diskualifikasi', pts: 0 } // aktif setelah P2; pelanggaran lagi = diskualifikasi
        ],
        quorum: 2 // nilai/teguran/peringatan SAH jika >= N juri menekan yang sama
    };

    const STATUS = {
        kosong: 'BELUM ADA PARTAI',
        siap: 'PERTANDINGAN BELUM DIMULAI',
        'siap-babak': 'BABAK SIAP DIMULAI',
        berlangsung: 'PERTANDINGAN BERLANGSUNG',
        dijeda: 'PERTANDINGAN DIJEDA',
        'waktu-habis': 'WAKTU BABAK HABIS',
        selesai: 'PERTANDINGAN SELESAI — MENUNGGU KEPUTUSAN DEWAN',
        final: 'HASIL RESMI DITETAPKAN'
    };

    let cacheRaw = null,
        cacheObj = null;
    const clone = o => JSON.parse(JSON.stringify(o));

    const emptySide = () => ({ tech: [0, 0, 0, 0], t: [false, false], p: [false, false], dis: [false] });
    const emptyJudge = () => ({ red: emptySide(), blue: emptySide(), submittedAt: null, revision: 0 });

    function emptyScores() {
        const s = {};
        for (let i = 1; i <= RULES.judgeCount; i++) s[i] = emptyJudge();
        return s;
    }
    /* hukuman (T/P/DIS) yang sudah berlaku di babak-babak sebelumnya: dibawa ke babak berikutnya */
    const emptyCarry = () => ({ red: { t: [false, false], p: [false, false], dis: [false] }, blue: { t: [false, false], p: [false, false], dis: [false] } });
    const newArena = n => ({
        id: n,
        match: null,
        timer: { running: false, remainingMs: 0, endsAt: null },
        scores: emptyScores(),
        result: null,
        audit: [],
        history: [],
        scoreLog: [],
        rounds: [],
        carry: emptyCarry(),
        roundOpen: false // nilai babak yang sudah selesai disimpan di rounds
    });

    function buildRounds(m) {
        const r = [];
        for (let i = 1; i <= m.babak; i++) r.push({ label: 'Babak ' + i, ms: Math.round(m.durasiMenit * 60000) });
        if (m.tambahan) r.push({ label: 'Tambahan', ms: Math.round(m.durasiTambahanMenit * 60000) });
        return r;
    }

    function audit(a, by, action, detail) {
        a.audit.unshift({ at: Date.now(), by: by || 'Sistem', action, detail: detail || '' });
        if (a.audit.length > 120) a.audit.length = 120;
    }

    /* Buat partai baru (mengosongkan skor, timer, hasil). */
    function createMatch(a, d, by) {
        const n = a.id;
        a.match = Object.assign({
            uid: 'A' + n + '-' + Date.now(),
            arena: n,
            roundIndex: 0,
            status: 'siap',
            createdAt: Date.now()
        }, d);
        a.scores = emptyScores();
        a.result = null;
        a.scoreLog = [];
        a.rounds = [];
        a.carry = emptyCarry();
        a.roundOpen = false;
        a.timer = { running: false, remainingMs: buildRounds(a.match)[0].ms, endsAt: null };
        audit(a, by, 'Partai disimpan', 'Partai ' + d.nomor + ': ' + d.red.nama + ' vs ' + d.blue.nama);
    }

    /* ---- Data Fighter (daftar partai global) & peserta loting ---- */
    const rid = p => p + Math.random().toString(36).slice(2, 8);
    const mkEntry = (d, extra) => Object.assign({
        id: rid('E'),
        babak: 2,
        durasiMenit: 2,
        tambahan: true,
        durasiTambahanMenit: 1,
        status: 'akan',
        arena: null,
        tanggal: null,
        hasil: null,
        ref: null,
        createdAt: Date.now()
    }, d, extra);
    const matchFromEntry = e => ({
        nomor: e.partai,
        kategori: 'Tanding ' + e.kategori,
        kelas: e.kelas,
        babak: e.babak,
        durasiMenit: e.durasiMenit,
        tambahan: e.tambahan,
        durasiTambahanMenit: e.durasiTambahanMenit,
        red: { nama: e.red.nama, kontingen: e.red.kontingen },
        blue: { nama: e.blue.nama, kontingen: e.blue.kontingen },
        juri: Array.from({ length: RULES.judgeCount }, (_, i) => 'Juri ' + (i + 1)),
        wasit: '',
        entryId: e.id
    });

    function seedState() {
        const f = (nama, kontingen) => ({ id: null, nama, kontingen });
        const e1 = mkEntry({ partai: '1', kategori: 'Dewasa Putra', kelas: 'Kelas B (50–55 kg)', red: f('Ahmad Fauzi', 'Tapak Suci Banda Aceh'), blue: f('Rizki Maulana', 'Tapak Suci Aceh Besar') }, { status: 'tampil', arena: 1 });
        const e2 = mkEntry({ partai: '2', kategori: 'Dewasa Putri', kelas: 'Kelas A (45–50 kg)', red: f('Nadia Salsabila', 'Tapak Suci Lhokseumawe'), blue: f('Putri Ayu', 'Tapak Suci Pidie') }, { status: 'tampil', arena: 2 });
        const e3 = mkEntry({ partai: '3', kategori: 'Dewasa Putra', kelas: 'Kelas B (50–55 kg)', red: f('Faisal Akbar', 'Tapak Suci Pidie'), blue: f('Teuku Rafi', 'Tapak Suci Bireuen') });
        const e4 = mkEntry({ partai: '4', kategori: 'Dewasa Putri', kelas: 'Kelas A (45–50 kg)', red: f('Salma Dewi', 'Tapak Suci Banda Aceh'), blue: f('Cut Aini', 'Tapak Suci Lhokseumawe') });
        const arenas = { 1: newArena(1), 2: newArena(2) };
        createMatch(arenas[1], matchFromEntry(e1), 'Sistem (data contoh)');
        createMatch(arenas[2], matchFromEntry(e2), 'Sistem (data contoh)');
        const L = (nama, kontingen, kategori, kelas) => ({ id: rid('L'), nama, kontingen, kategori, kelas });
        const KB = 'Kelas B (50–55 kg)',
            KA = 'Kelas A (45–50 kg)';
        const peserta = [
            L('Dimas Pratama', 'Tapak Suci Banda Aceh', 'Dewasa Putra', KB), L('Hafiz Ramadhan', 'Tapak Suci Aceh Besar', 'Dewasa Putra', KB),
            L('Irfan Maulidi', 'Tapak Suci Pidie', 'Dewasa Putra', KB), L('Khairul Anwar', 'Tapak Suci Bireuen', 'Dewasa Putra', KB),
            L('Mufti Alfarisi', 'Tapak Suci Lhokseumawe', 'Dewasa Putra', KB), L('Naufal Hakim', 'Tapak Suci Aceh Utara', 'Dewasa Putra', KB),
            L('Aulia Rahma', 'Tapak Suci Banda Aceh', 'Dewasa Putri', KA), L('Dewi Sartika', 'Tapak Suci Pidie', 'Dewasa Putri', KA),
            L('Fitria Nur', 'Tapak Suci Bireuen', 'Dewasa Putri', KA), L('Maulida Sari', 'Tapak Suci Aceh Besar', 'Dewasa Putri', KA),
            L('Fikri Akbar', 'Tapak Suci Banda Aceh', 'Remaja Putra', 'Kelas Remaja A'), L('Rendi Saputra', 'Tapak Suci Pidie', 'Remaja Putra', 'Kelas Remaja A'),
            L('Yusuf Hanafi', 'Tapak Suci Bireuen', 'Remaja Putra', 'Kelas Remaja A'),
            L('Nabila Zahra', 'Tapak Suci Aceh Besar', 'Remaja Putri', 'Kelas Remaja A'), L('Syifa Amalia', 'Tapak Suci Lhokseumawe', 'Remaja Putri', 'Kelas Remaja A'),
            L('Raka Aditya', 'Tapak Suci Banda Aceh', 'Usia Dini Putra', 'Usia Dini 1'), L('Zidan Alfath', 'Tapak Suci Pidie', 'Usia Dini Putra', 'Usia Dini 1'),
            L('Alif Nugraha', 'Tapak Suci Bireuen', 'Usia Dini Putra', 'Usia Dini 1'),
            L('Keysha Putri', 'Tapak Suci Banda Aceh', 'Usia Dini Putri', 'Usia Dini 1'), L('Nayla Safira', 'Tapak Suci Pidie', 'Usia Dini Putri', 'Usia Dini 1')
        ];
        return { version: 4, fightList: [e1, e2, e3, e4], loting: { peserta, draws: {} }, arenas };
    }

    /* Mulai KOSONG (tanpa data contoh) — dipakai halaman reset-data.html */
    const emptyState = () => ({ version: 4, fightList: [], loting: { peserta: [], draws: {} }, arenas: { 1: newArena(1), 2: newArena(2) } });

    function load() {
        const raw = localStorage.getItem(KEY);
        if (raw && raw === cacheRaw) return cacheObj;
        let obj = null;
        if (raw) { try { obj = JSON.parse(raw); } catch (e) { obj = null; } }
        if (!obj || !obj.arenas || !obj.arenas[1] || !obj.arenas[2] || !obj.fightList || !obj.loting) {
            obj = seedState();
            save(obj);
            return obj;
        }
        cacheRaw = raw;
        cacheObj = obj;
        return obj;
    }

    function save(state) {
        const raw = JSON.stringify(state);
        localStorage.setItem(KEY, raw);
        cacheRaw = raw;
        cacheObj = state;

        // Otomatis tembak ke Firebase
        if (typeof window !== 'undefined' && window.firebaseDb && window.firebaseRef && window.firebaseSet) {
            window.firebaseSet(window.firebaseRef(window.firebaseDb, 'atsc_state'), state)
                .catch(err => console.error("Gagal sinkron: ", err));
        }
    }
    const getArena = n => load().arenas[n];
    /* Ubah data global (bukan milik satu arena), mis. peserta loting. */
    function mutate(fn) {
        const s = clone(load());
        const out = fn(s);
        save(s);
        return out;
    }

    /* Baca-ubah-simpan satu arena. Arena lain TIDAK disentuh. */
    function update(n, fn) {
        const s = clone(load());
        const out = fn(s.arenas[n], s);
        save(s);
        return out;
    }

    function resetAll() {
        localStorage.removeItem(KEY);
        cacheRaw = cacheObj = null;
        return load();
    }

    function effStatus(a) {
        const st = a.match ? a.match.status : 'kosong';
        if (st === 'berlangsung' && a.timer.running && Date.now() >= a.timer.endsAt) return 'waktu-habis';
        return st;
    }

    // Otomatis tarik data dari Firebase jika ada perubahan dari HP Juri
    if (typeof window !== 'undefined') {
        setTimeout(() => {
            if (window.firebaseDb && window.firebaseRef && window.firebaseOnValue) {
                window.firebaseOnValue(window.firebaseRef(window.firebaseDb, 'atsc_state'), (snapshot) => {
                    const data = snapshot.val();
                    if (data) {
                        const raw = JSON.stringify(data);
                        if (raw !== localStorage.getItem(KEY)) {
                            localStorage.setItem(KEY, raw);
                            cacheRaw = raw;
                            cacheObj = data;
                            window.dispatchEvent(new Event('storage'));
                            // ← INI YANG HARUS DIHAPUS!
                        }
                    }
                });
            }
        }, 1500);
    }
    return {
        KEY,
        RULES,
        STATUS,
        clone,
        emptyCarry,
        emptySide,
        emptyScores,
        newArena,
        buildRounds,
        audit,
        createMatch,
        matchFromEntry,
        emptyState,
        seedState,
        load,
        save,
        getArena,
        update,
        mutate,
        resetAll,
        effStatus
    };
})();