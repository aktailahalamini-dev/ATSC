/* =====================================================================
   results.js — hitung skor resmi sementara & penetapan hasil oleh Dewan.
   Hanya Dewan yang dapat menetapkan pemenang. Skor tertinggi HANYA
   informasi; pemenang tidak ditentukan otomatis.
   ===================================================================== */
const ATSC_RESULTS = (() => {
    'use strict';
    const R = () => ATSC.RULES;
    const r1 = x => Math.round(x * 10) / 10;
    const fmtScore = x => (Number.isInteger(x) ? String(x) : x.toFixed(1));
    /* nilai ke-q terbesar: sebuah nilai "diakui" bila >= q juri mencapainya */
    const lvl = (vals, q) => { const s = vals.slice().sort((x, y) => y - x); return s.length >= q ? s[q - 1] : 0; };
    const techOf = side => side.tech.reduce((t, c, i) => t + c * R().techButtons[i].pts, 0);

    const penOf = side => R().penaltyBtns.reduce((t, b) => t + ((side[b.key] || [])[b.idx] ? b.pts : 0), 0);
    /* Nilai milik satu juri sendiri (belum tentu sah) */
    const ownOf = side => techOf(side) + penOf(side);

    /* Nilai SATU BABAK. Poin teknik sah bila >= quorum juri menekan yang sama; nilai direset tiap babak baru
     (nilai babak lama tersimpan di a.rounds). Hukuman T/P/DIS yang sudah sah di babak sebelumnya DIBAWA ke babak
     berikutnya (tetap menyala) dan tidak dikurangkan dua kali. DIS bersifat permanen sampai akhir pertandingan. */
    function computeSide(a, key) {
        const js = Object.values(a.scores || {}).filter(j => j !== null && j !== undefined);
        const q = R().quorum;

        const tech = R().techButtons.reduce((t, b, i) => t + lvl(js.map(j => {
            // Ambil data berdasarkan key ('yellow'), jika kosong fallback ke 'red'
            const sideData = (j && (j[key] || j['red'])) || {};
            return (sideData.tech && sideData.tech[i]) ? sideData.tech[i] : 0;
        }), q) * b.pts, 0);

        // ... sisa kode di bawahnya biarkan seperti semula ...
        const flag = f => [0, 1].map(k => !!(carry[f] && carry[f][k]) || lvl(js.map(j => ((j[key][f] || [])[k] ? 1 : 0)), q) === 1);
        const t = flag('t'),
            p = flag('p'),
            dis = flag('dis'),
            fl = { t, p, dis };
        const penTotal = R().penaltyBtns.reduce((x, b) => x + (fl[b.key][b.idx] && !(carry[b.key] && carry[b.key][b.idx]) ? b.pts : 0), 0);
        const score = r1(tech + penTotal),
            prev = (a.rounds || []).reduce((s, r) => s + r[key].score, 0);
        return { tech, t, p, dis: dis[0], penTotal, score, total: r1(prev + score), judges: js.filter(j => j.submittedAt).length };
    }
    const compute = a => ({
        red: computeSide(a, 'yellow'),
        blue: computeSide(a, 'blue'),
        submitted: Object.values(a.scores).filter(j => j.submittedAt).length
    });

    /* Daftar nilai per babak: babak yang sudah selesai + babak berjalan */
    function roundsList(a) {
        const sc = compute(a),
            m = a.match,
            cur = m ? ATSC.buildRounds(m)[m.roundIndex] : null;
        const list = (a.rounds || []).map(r => ({ idx: r.idx, label: r.label, yellow: r.red.score, blue: r.blue.score, done: true }));
        if (cur) list.push({ idx: m.roundIndex, label: cur.label, yellow: sc.red.score, blue: sc.blue.score, done: false });
        return list;
    }
    /* Simpan nilai babak berjalan lalu RESET nilai untuk babak baru (dipanggil saat Dewan ganti babak) */
    function archiveRound(a) {
        const sc = compute(a),
            m = a.match;
        a.rounds = a.rounds || [];
        a.rounds.push({
            idx: m.roundIndex,
            label: ATSC.buildRounds(m)[m.roundIndex].label,
            at: Date.now(),
            yellow: { tech: sc.red.tech, pen: sc.red.penTotal, score: sc.red.score },
            blue: { tech: sc.blue.tech, pen: sc.blue.penTotal, score: sc.blue.score },
            judges: JSON.parse(JSON.stringify(a.scores))
        });
        a.carry = { yellow: { t: sc.red.t.slice(), p: sc.red.p.slice(), dis: [sc.red.dis] }, blue: { t: sc.blue.t.slice(), p: sc.blue.p.slice(), dis: [sc.blue.dis] } };
        a.scores = ATSC.emptyScores();
        a.roundOpen = false;
    }

    /* Dewan menetapkan / mengoreksi hasil resmi. data: {winnerSide:'red'|'blue'|null, basis, notes, reason} */
    function confirm(n, data, by) {
        return ATSC.update(n, (a, s) => {
            const m = a.match;
            if (!m) return { ok: false, msg: 'Belum ada partai.' };
            const correcting = m.status === 'final';
            if (!correcting && m.status !== 'selesai') return { ok: false, msg: 'Akhiri pertandingan terlebih dahulu.' };
            if (!data.basis) return { ok: false, msg: 'Dasar keputusan wajib dipilih.' };
            if (data.basis === 'Diskualifikasi lawan' && !data.winnerSide) return { ok: false, msg: 'Diskualifikasi memerlukan pemenang (kuning atau biru).' };
            if (!data.winnerSide && !data.notes) return { ok: false, msg: 'Untuk hasil seri / belum ada pemenang, isi catatan.' };
            if (correcting && !data.reason) return { ok: false, msg: 'Alasan koreksi wajib diisi.' };
            const ent = typeof FD !== 'undefined' ? FD.entryOf(s, a) : null;
            if (ent) { const wid = data.winnerSide ? ent[data.winnerSide].id || null : null; const err = FD.canSetWinner(s, ent, wid); if (err) return { ok: false, msg: err }; }
            const sc = compute(a),
                prev = a.result;
            a.result = {
                type: data.winnerSide ? 'menang-' + data.winnerSide : 'seri',
                winnerSide: data.winnerSide || null,
                basis: data.basis,
                notes: data.notes || '',
                scores: { yellow: sc.yellow.score, blue: sc.blue.score },
                rounds: roundsList(a),
                by,
                at: Date.now(),
                correctionReason: correcting ? data.reason : ''
            };
            m.status = 'final';
            if (ent) FD.applyResult(s, a);
            if (correcting) ATSC.audit(a, by, 'Koreksi hasil', `Alasan: ${data.reason}. Sebelumnya: ${describe(a, prev)}`);
            else ATSC.audit(a, by, 'Hasil resmi', describe(a, a.result));
            return { ok: true, msg: correcting ? 'Koreksi hasil disimpan.' : 'Hasil resmi ditetapkan.' };
        });
    }

    function describe(a, r) {
        if (!r) return '-';
        return r.winnerSide ? `${a.match[r.winnerSide].nama} (Sudut ${r.winnerSide === 'yellow' ? 'Kuning' : 'Biru'}), dasar: ${r.basis}` : `Seri/belum ada pemenang, dasar: ${r.basis}`;
    }
    return { compute, roundsList, archiveRound, fmtScore, confirm, describe, techOf, ownOf };
})();