/* scoreboard.js — tampilan publik Live Score per arena (hanya baca, tanpa kontrol). */
(() => {
    'use strict';
    const n = UI.arenaParam();
    if (!n) { location.replace('index.html'); return; }
    const $ = UI.$,
        R = ATSC.RULES;
    document.title = `Live Score Arena ${n} — ATSC IV`;
    $('arenaTag').textContent = `ARENA ${n} · LIVE SCORE`;
    $('fsBtn').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();

    const pill = (t, on) => `<span class="pill${on ? ' on' : ''}">${t}</span>`;
    /* Tombol T1 T2 P1 P2 menyala bila sah (>= 2 juri) */
    const penHTML = s => R.penaltyBtns.map(b => `<span class="pill${(s[b.key] || [])[b.idx] ? ' on' : ''}${b.key === 'dis' ? ' dis' : ''}" title="${b.name}">${b.label}</span>`).join('');

    function render() {
        const a = ATSC.getArena(n),
            m = a.match,
            st = ATSC.effStatus(a);
        const sb = $('statusBar');
        UI.setText(sb, ATSC.STATUS[st]);
        sb.dataset.st = st;
        if (!m) {
            ['redName', 'blueName'].forEach(i => UI.setText($(i), '—'));
            ['redKont', 'blueKont', 'kelas'].forEach(i => UI.setText($(i), ''));
            UI.setText($('partai'), '—');
            UI.setText($('kategori'), '—');
            UI.setText($('babak'), 'BABAK');
            UI.setText($('timer'), '00:00');
            UI.setText($('redScore'), '0');
            UI.setText($('blueScore'), '0');
            $('sideRed').classList.remove('dq');
            $('sideBlue').classList.remove('dq');
            $('winner').hidden = true;
            return;
        }
        const sc = ATSC_RESULTS.compute(a),
            rem = ATSC_TIMER.remaining(a);
        UI.setText($('partai'), m.nomor);
        UI.setText($('kategori'), m.kategori);
        UI.setText($('kelas'), m.kelas || '');
        UI.setText($('babak'), ATSC_TIMER.roundOf(a).label.toUpperCase());
        UI.setText($('redName'), m.red.nama);
        UI.setText($('redKont'), m.red.kontingen);
        UI.setText($('blueName'), m.blue.nama);
        UI.setText($('blueKont'), m.blue.kontingen);
        UI.setNum($('redScore'), ATSC_RESULTS.fmtScore(sc.red.score));
        UI.setNum($('blueScore'), ATSC_RESULTS.fmtScore(sc.blue.score));
        /* rekap per babak: nilai babak lama tetap tampil & tersimpan; TOTAL = jumlah semua babak */
        const rl = ATSC_RESULTS.roundsList(a),
            fs = ATSC_RESULTS.fmtScore,
            sh = l => (l.indexOf('Babak ') === 0 ? 'B' + l.slice(6) : 'TB');
        const recap = k => rl.length > 1 ? rl.map(r => `<span class="${r.done ? '' : 'cur'}">${sh(r.label)} <b>${fs(r[k])}</b></span>`).join('') + `<span class="tot">TOTAL <b>${fs(sc[k].total)}</b></span>` : '';
        UI.setHTML($('redRnd'), recap('red'));
        UI.setHTML($('blueRnd'), recap('blue'));
        $('sideRed').classList.toggle('dq', !!sc.red.dis);
        $('sideBlue').classList.toggle('dq', !!sc.blue.dis);
        UI.setHTML($('redPen'), penHTML(sc.red));
        UI.setHTML($('bluePen'), penHTML(sc.blue));
        const t = $('timer');
        UI.setText(t, ATSC_TIMER.fmt(rem));
        t.classList.toggle('low', a.timer.running && rem <= 10000);
        t.classList.toggle('paused', st === 'dijeda');

        const w = $('winner');
        if (st === 'final' && a.result) {
            const r = a.result;
            w.hidden = false;
            w.className = 'winner ' + (r.winnerSide || 'draw');
            if (r.winnerSide) {
                UI.setText($('wTitle'), 'PEMENANG PERTANDINGAN');
                UI.setText($('wName'), `${m[r.winnerSide].nama.toUpperCase()} — SUDUT ${r.winnerSide === 'red' ? 'KUNING' : 'BIRU'}`);
                UI.setText($('wSub'), `${m[r.winnerSide].kontingen} · ${r.basis}`);
            } else {
                UI.setText($('wTitle'), 'HASIL PERTANDINGAN');
                UI.setText($('wName'), 'SERI / BELUM ADA PEMENANG');
                UI.setText($('wSub'), r.basis);
            }
        } else w.hidden = true;
    }
    UI.every(render, 200);
})();