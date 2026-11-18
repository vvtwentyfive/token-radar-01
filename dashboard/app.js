"use strict";
/* Launch Radar dashboard. Reads window.RADAR (data.js) and calls
   window.RadarEngine (engine.js) for every recompute and farm plan. */
(function () {
  var D = window.RADAR, E = window.RadarEngine;
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  if (!D || !E) {
    var m = $("main");
    if (m) m.insertAdjacentHTML("afterbegin",
      '<p role="alert" style="color:#f26d6d">Radar data failed to load. The snapshot file or the model engine is missing.</p>');
    return;
  }

  var M0 = D.model, FIT = D.fit;
  var rows = D.rows || [], live = D.live || [];
  var state = { q: "", cat: "", chain: "", wl: false, tab: "board",
    sort: { key: "rank", dir: 1 }, liveSort: { key: "mcap", dir: -1 },
    sb: null, detail: null, opener: null };
  var sbMap = null; /* slug -> {imp, low, high, sRank} while sandbox is active */

  /* ---------- formatting ---------- */
  function money(v) {
    if (v == null || !isFinite(v)) return "—";
    var a = Math.abs(v), u = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
    for (var i = 0; i < u.length; i++) {
      if (a >= u[i][0]) {
        var x = v / u[i][0];
        return "$" + x.toFixed(a >= u[i][0] * 100 ? 0 : a >= u[i][0] * 10 ? 1 : 2) + u[i][1];
      }
    }
    return "$" + (a < 10 && a !== Math.round(a) ? v.toFixed(2) : String(Math.round(v)));
  }
  function pct(v) {
    if (v == null || !isFinite(v)) return "—";
    return (v > 0 ? "+" : "") + v.toFixed(1) + "%";
  }
  function pctCls(v) { return v == null ? "" : v > 0 ? "up" : v < 0 ? "down" : ""; }
  function ageStr(a) { return a == null ? "Unknown" : Math.round(a) + "d"; }
  function intStr(n) { return n == null ? "—" : Number(n).toLocaleString("en-US"); }
  function f3(n) { return Number(n).toFixed(3); }

  /* ---------- engine calls (never reimplemented here) ---------- */
  function like(r) {
    return { tvl_usd: r.tvl_usd, change_7d: r.change_7d, listed_at: r.listed_at, chains: r.chains || [] };
  }
  function recalc(r, model) {
    try { return E.impliedValue(like(r), D.as_of, FIT, model); } catch (e) { return null; }
  }
  function effModel() {
    if (!state.sb) return M0;
    return { growth_weight: state.sb.gw, growth_floor: M0.growth_floor, growth_cap: M0.growth_cap,
      maturity_floor: state.sb.mf, maturity_range: M0.maturity_range, maturity_days: M0.maturity_days,
      unknown_age_days: M0.unknown_age_days, breadth_step: state.sb.bs,
      breadth_max_extra: M0.breadth_max_extra };
  }
  function rebuildSandbox() {
    sbMap = {};
    var model = effModel();
    var list = rows.map(function (r) {
      var c = recalc(r, model) || { implied: r.implied_value_usd, low: r.implied_low_usd, high: r.implied_high_usd };
      return { slug: r.slug, imp: c.implied, low: c.low, high: c.high };
    });
    list.sort(function (a, b) { return b.imp - a.imp; });
    list.forEach(function (x, i) { x.sRank = i + 1; sbMap[x.slug] = x; });
  }
  function impOf(r) { return sbMap ? sbMap[r.slug].imp : r.implied_value_usd; }
  function lowOf(r) { return sbMap ? sbMap[r.slug].low : r.implied_low_usd; }
  function highOf(r) { return sbMap ? sbMap[r.slug].high : r.implied_high_usd; }

  /* ---------- filtering + sorting ---------- */
  function matchRow(r, isLive) {
    if (state.q) {
      var hay = (r.name + " " + r.slug + " " + r.category + " " + (r.chains || []).join(" ")).toLowerCase();
      if (hay.indexOf(state.q) < 0) return false;
    }
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
    if (!isLive && state.wl && !r.on_watchlist) return false;
    return true;
  }
  function val(r, key) {
    switch (key) {
      case "rank": return sbMap ? sbMap[r.slug].sRank : r.rank;
      case "name": return (r.name || "").toLowerCase();
      case "tvl": return r.tvl_usd;
      case "change": return r.change_7d;
      case "age": return r.age_days;
      case "chains": return (r.chains || []).length;
      case "implied": return impOf(r);
      case "mcap": return r.mcap_usd;
    }
    return 0;
  }
  function sortList(list, sort) {
    var k = sort.key, d = sort.dir;
    return list.slice().sort(function (a, b) {
      var x = val(a, k), y = val(b, k);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (x < y) return -d;
      if (x > y) return d;
      return (a.rank || 0) - (b.rank || 0);
    });
  }

  /* ---------- rendering: board + live ---------- */
  function protocolCell(r, showDot) {
    var dot = showDot && r.on_watchlist
      ? '<span class="wdot" title="On watchlist" aria-label="On watchlist"></span>' : "";
    return '<span class="pname">' + esc(r.name) + dot + "</span>" +
      '<span class="psub">' + esc(r.category) + " · " + esc((r.chains || []).join(", ")) + "</span>";
  }
  function renderBoard() {
    var list = sortList(rows.filter(function (r) { return matchRow(r, false); }), state.sort);
    var max = 0;
    list.forEach(function (r) { if (impOf(r) > max) max = impOf(r); });
    var html = list.map(function (r) {
      var imp = impOf(r), w = max > 0 ? Math.max(2, imp / max * 100) : 0;
      var rank = sbMap
        ? '<span class="num">S' + sbMap[r.slug].sRank + '</span> <span class="dim num">#' + r.rank + "</span>"
        : '<span class="num">#' + r.rank + "</span>";
      return '<tr tabindex="0" data-slug="' + esc(r.slug) + '"' +
        (state.detail === r.slug ? ' class="sel"' : "") + ">" +
        "<td>" + rank + "</td>" +
        "<td>" + protocolCell(r, true) + "</td>" +
        '<td class="r num">' + money(r.tvl_usd) + "</td>" +
        '<td class="r num ' + pctCls(r.change_7d) + '">' + pct(r.change_7d) + "</td>" +
        '<td class="r num">' + ageStr(r.age_days) + "</td>" +
        '<td class="r num">' + (r.chains || []).length + "</td>" +
        '<td class="r"><span class="imp"><span class="bar" aria-hidden="true"><i style="width:' +
        w.toFixed(1) + '%"></i></span><span class="num">' + money(imp) +
        '</span><span class="range num">' + money(lowOf(r)) + "–" + money(highOf(r)) + "</span></span></td></tr>";
    }).join("");
    $("boardBody").innerHTML = html;
    $("boardEmpty").hidden = list.length > 0;
    $("boardTable").style.display = list.length ? "" : "none";
    markSort($("boardTable"), state.sort);
    return list.length;
  }
  function renderLive() {
    var list = sortList(live.filter(function (r) { return matchRow(r, true); }), state.liveSort);
    $("liveBody").innerHTML = list.map(function (r) {
      return "<tr><td>" + protocolCell(r, false) + "</td>" +
        '<td class="r num">' + money(r.tvl_usd) + "</td>" +
        '<td class="r num ' + pctCls(r.change_7d) + '">' + pct(r.change_7d) + "</td>" +
        '<td class="r num">' + (r.chains || []).length + "</td>" +
        '<td class="r num">' + money(r.mcap_usd) + "</td></tr>";
    }).join("");
    $("liveEmpty").hidden = list.length > 0;
    $("liveTable").style.display = list.length ? "" : "none";
    markSort($("liveTable"), state.liveSort);
    return list.length;
  }
  function markSort(table, sort) {
    table.querySelectorAll("th").forEach(function (th) {
      var b = th.querySelector("button");
      if (b && b.dataset.key === sort.key) th.setAttribute("aria-sort", sort.dir > 0 ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
    });
  }
  function renderCount(nBoard, nLive) {
    var t = state.tab === "board"
      ? intStr(nBoard) + " of " + intStr(rows.length) + " pre-token rows"
      : intStr(nLive) + " of " + intStr(live.length) + " live tokens";
    if (sbMap) t += " · sandbox ranks";
    $("count").textContent = t;
  }
  function renderAll() {
    var nb = renderBoard(), nl = renderLive();
    renderCount(nb, nl);
    syncSticky();
  }
  /* The controls bar wraps to two lines when the count text grows (e.g.
     sandbox mode), so the sticky thead offset tracks its live height. */
  function syncSticky() {
    var top = ($("controls").offsetHeight - 1) + "px";
    document.querySelectorAll("thead th").forEach(function (th) { th.style.top = top; });
  }

  /* ---------- detail slide-over ---------- */
  function openDetail(slug, opener) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    state.detail = slug;
    state.opener = opener || null;
    renderDetail(r);
    $("detail").classList.add("open");
    $("detail").setAttribute("aria-hidden", "false");
    $("scrim").classList.add("open");
    renderBoard();
    syncHash();
    /* Focus after the slide-in: the panel is visibility:hidden until the
       transition flips it, and focus() during that window is a no-op. */
    var h = $("detailTitle");
    if (h) setTimeout(function () { h.focus(); }, 200);
  }
  function closeDetail() {
    if (!state.detail) return;
    var slug = state.detail;
    state.detail = null;
    $("detail").classList.remove("open");
    $("detail").setAttribute("aria-hidden", "true");
    $("scrim").classList.remove("open");
    renderBoard();
    syncHash();
    var tr = document.querySelector('tr[data-slug="' + slug + '"]');
    if (tr) tr.focus();
    else if (state.opener && state.opener.focus) state.opener.focus();
  }
  function renderDetail(r) {
    var age = r.age_days;
    var ageNote = age == null
      ? "listing date unknown — model assumes " + M0.unknown_age_days + "d"
      : "listed " + esc(r.listed_at || "—");
    /* Recompute check: page recompute vs the board's stored value. */
    var c = recalc(r, M0), reLine;
    if (c && r.implied_value_usd && Math.abs(c.implied - r.implied_value_usd) / r.implied_value_usd < 0.01) {
      reLine = "Page recompute: " + money(c.implied) + " — matches board.json.";
    } else if (c) {
      reLine = "Page recompute: " + money(c.implied) + " (board.json: " + money(r.implied_value_usd) + ").";
    } else {
      reLine = "Page recompute unavailable for this row.";
    }
    /* Farm plan: built by the engine, so page and board.json agree. */
    var planAge = age;
    if (planAge == null) { try { planAge = E.ageDays(D.as_of, r.listed_at); } catch (e) { planAge = null; } }
    var steps = [], totals = null;
    try {
      steps = E.farmSteps(r, planAge);
      totals = E.planTotals(steps);
    } catch (e) { steps = []; }
    var planHtml = steps.map(function (s) {
      var text = s.text || E.stepText(s);
      var chips = "";
      if (s.cost) chips += '<span class="chip">' + esc(s.cost) + "</span>";
      if (s.time) chips += '<span class="chip">' + esc(s.time) + "</span>";
      return '<li><span class="ptext">' + esc(text) + "</span>" +
        (chips ? '<span class="chips">' + chips + "</span>" : "") + "</li>";
    }).join("");
    var totLine = totals
      ? "Gas " + money(totals.gas_usd) + " · Capital " + money(totals.capital_usd) +
        " · " + intStr(totals.active_minutes) + " active minutes · " + intStr(totals.hold_days) + " hold days"
      : "Plan totals unavailable.";
    $("detailInner").innerHTML =
      '<button type="button" class="dclose" id="dClose">Close ✕</button>' +
      '<h2 id="detailTitle" tabindex="-1">' + esc(r.name) + "</h2>" +
      '<p class="dsub num">Rank #' + r.rank + " · " + esc(r.category) + " · " + esc((r.chains || []).join(", ")) + "</p>" +
      '<dl class="facts">' +
      "<div><dt>TVL</dt><dd class=\"num\">" + money(r.tvl_usd) + "</dd></div>" +
      "<div><dt>7d change</dt><dd class=\"num " + pctCls(r.change_7d) + "\">" + pct(r.change_7d) + "</dd></div>" +
      "<div><dt>Age</dt><dd class=\"num\">" + ageStr(age) + "</dd></div>" +
      "<div><dt>Chains</dt><dd class=\"num\">" + (r.chains || []).length + "</dd></div>" +
      "<div><dt>Market cap</dt><dd class=\"num\">" + money(r.mcap_usd) + "</dd></div>" +
      "<div><dt>Watchlist</dt><dd>" + (r.on_watchlist ? "Yes — on the watchlist" : "No") + "</dd></div>" +
      "</dl>" +
      "<h3>Model breakdown</h3>" +
      '<ul class="breakdown">' +
      '<li><span class="blabel">Fitted base<small>from TVL ' + money(r.tvl_usd) + " on the fitted curve</small></span>" +
      '<span class="bval num">' + money(r.base_usd) + "</span></li>" +
      '<li><span class="blabel">Growth<small>7d ' + pct(r.change_7d) + ", weight " + M0.growth_weight + ", clipped " +
      M0.growth_floor + "% to " + M0.growth_cap + "%</small></span>" +
      '<span class="bval num">×' + Number(r.growth_multiplier).toFixed(3) + "</span></li>" +
      '<li><span class="blabel">Maturity' +
      "<small>" + ageNote + "; floor " + M0.maturity_floor + ", full at " + intStr(M0.maturity_days) + "d</small></span>" +
      '<span class="bval num">×' + Number(r.maturity_multiplier).toFixed(3) + "</span></li>" +
      '<li><span class="blabel">Breadth' +
      "<small>" + (r.chains || []).length + ((r.chains || []).length === 1 ? " chain, +" : " chains, +") + M0.breadth_step + " per extra chain, at most " + M0.breadth_max_extra + " counted</small></span>" +
      '<span class="bval num">×' + Number(r.breadth_multiplier).toFixed(3) + "</span></li>" +
      '<li class="total"><span class="blabel">Implied value<small>range ' + money(r.implied_low_usd) +
      " – " + money(r.implied_high_usd) + "</small></span>" +
      '<span class="bval num">' + money(r.implied_value_usd) + "</span></li>" +
      "</ul>" +
      '<p class="recompute">' + esc(reLine) + "</p>" +
      "<h3>Farm plan</h3>" +
      (steps.length ? '<ol class="plan">' + planHtml + "</ol>" : "<p>No plan available for this protocol.</p>") +
      '<p class="totals num">' + esc(totLine) + "</p>" +
      '<p class="risk">Plans are generic playbooks from category, chain, TVL, and age — verify on the protocol&rsquo;s own page; never pay to claim.</p>';
    $("dClose").addEventListener("click", closeDetail);
  }

  /* ---------- hash state ---------- */
  function syncHash() {
    var p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.cat) p.set("category", state.cat);
    if (state.chain) p.set("chain", state.chain);
    if (state.wl) p.set("watchlist", "1");
    if (state.tab !== "board") p.set("tab", state.tab);
    if (state.detail) p.set("p", state.detail);
    var s = p.toString();
    history.replaceState(null, "", s ? "#" + s : location.pathname + location.search);
  }
  function readHash() {
    var p = new URLSearchParams(location.hash.replace(/^#/, ""));
    state.q = p.get("q") || "";
    state.cat = p.get("category") || "";
    state.chain = p.get("chain") || "";
    state.wl = p.get("watchlist") === "1";
    state.tab = p.get("tab") === "live" ? "live" : "board";
    var cats = {}, chains = {};
    rows.concat(live).forEach(function (r) {
      cats[r.category] = 1;
      (r.chains || []).forEach(function (c) { chains[c] = 1; });
    });
    if (state.cat && !cats[state.cat]) state.cat = "";
    if (state.chain && !chains[state.chain]) state.chain = "";
    var slug = p.get("p") || "";
    state.detail = null;
    rows.forEach(function (r) { if (r.slug === slug) state.detail = slug; });
  }

  /* ---------- tabs ---------- */
  function setTab(tab) {
    state.tab = tab;
    var isBoard = tab === "board";
    $("tabBoard").setAttribute("aria-selected", isBoard ? "true" : "false");
    $("tabLive").setAttribute("aria-selected", isBoard ? "false" : "true");
    $("boardWrap").hidden = !isBoard;
    $("liveWrap").hidden = isBoard;
    $("modelPanel").style.display = isBoard ? "" : "none";
    renderAll();
    syncHash();
  }

  /* ---------- sandbox ---------- */
  function sbValues() {
    return { gw: parseFloat($("sbGrowth").value), mf: parseFloat($("sbMaturity").value),
      bs: parseFloat($("sbBreadth").value) };
  }
  function sbIsDefault(v) {
    return v.gw === M0.growth_weight && v.mf === M0.maturity_floor && v.bs === M0.breadth_step;
  }
  function onSandboxInput() {
    var v = sbValues();
    $("sbGrowthVal").textContent = v.gw.toFixed(2);
    $("sbMaturityVal").textContent = v.mf.toFixed(2);
    $("sbBreadthVal").textContent = v.bs.toFixed(3);
    var wasActive = !!state.sb;
    state.sb = sbIsDefault(v) ? null : v;
    if (state.sb) {
      rebuildSandbox();
      if (!wasActive) state.sort = { key: "implied", dir: -1 };
    } else {
      sbMap = null;
    }
    $("sandboxBadge").hidden = !state.sb;
    renderAll();
  }
  function resetSandbox() {
    $("sbGrowth").value = M0.growth_weight;
    $("sbMaturity").value = M0.maturity_floor;
    $("sbBreadth").value = M0.breadth_step;
    state.sb = null;
    sbMap = null;
    state.sort = { key: "rank", dir: 1 };
    onSandboxInput();
  }

  /* ---------- static content from DATA ---------- */
  function fillStatic() {
    $("metaDate").textContent = D.as_of;
    $("metaModel").textContent = D.model_version;
    $("metaSource").textContent = D.source;
    var covered = rows.filter(function (r) { return r.on_watchlist; }).length;
    $("headline").textContent = covered + " of " + D.watchlist_size + " watchlist protocols appear on the board, across " +
      rows.length + " pre-token rows — " + D.early_size + " of them early rows below the " +
      money(D.floor_usd) + " TVL floor.";
    $("tileWatch").textContent = covered + "/" + D.watchlist_size;
    $("tileRows").textContent = intStr(rows.length);
    $("tileEarly").textContent = intStr(D.early_size);
    $("tileLive").textContent = intStr(D.live_size);
    /* selects */
    var cats = {}, chains = {};
    rows.concat(live).forEach(function (r) {
      cats[r.category] = 1;
      (r.chains || []).forEach(function (c) { chains[c] = 1; });
    });
    Object.keys(cats).sort().forEach(function (c) {
      $("cat").insertAdjacentHTML("beforeend", '<option value="' + esc(c) + '">' + esc(c) + "</option>");
    });
    Object.keys(chains).sort().forEach(function (c) {
      $("chain").insertAdjacentHTML("beforeend", '<option value="' + esc(c) + '">' + esc(c) + "</option>");
    });
    /* model panel */
    $("equation").textContent = "log10(mcap) = " + f3(FIT.intercept) + " + " + f3(FIT.slope) + " × log10(TVL)";
    $("fitSummary").textContent = "Fitted on " + FIT.n + " live-token comps in the same snapshot (R² " +
      f3(FIT.r2) + "). Each protocol's TVL runs through this curve to give a fitted base value; the overlays below then adjust it.";
    $("looBox").innerHTML = '<table class="mini"><tbody>' +
      "<tr><td>Model, leave-one-out RMSE</td><td class=\"num\">" + f3(FIT.loo_rmse_log10) + " (log10)</td></tr>" +
      "<tr><td>Model, leave-one-out MAE</td><td class=\"num\">" + f3(FIT.loo_mae_log10) + " (log10)</td></tr>" +
      "<tr><td>Flat-multiple baseline RMSE</td><td class=\"num\">" + f3(FIT.base_rmse_log10) + " (log10)</td></tr>" +
      "<tr><td>Flat-multiple baseline MAE</td><td class=\"num\">" + f3(FIT.base_mae_log10) + " (log10)</td></tr>" +
      "</tbody></table>";
    var f = Math.pow(10, FIT.resid_sd_log10);
    $("bandText").textContent = "Residual SD " + f3(FIT.resid_sd_log10) + " in log10, so each low–high band is roughly ×" +
      f.toFixed(2) + " / ÷" + f.toFixed(2) + " around the implied value — the band is the fit's own scatter, not a forecast interval.";
    $("overlayList").innerHTML =
      "<li><b>Growth</b> — 7d TVL change, clipped to " + M0.growth_floor + "%…" + M0.growth_cap +
      "%, scaled by weight " + M0.growth_weight + ". A fast-growing protocol is worth more than its TVL alone suggests; the clip stops one hot week from dominating.</li>" +
      "<li><b>Maturity</b> — starts at " + M0.maturity_floor + " for a newborn protocol and rises to " +
      (M0.maturity_floor + M0.maturity_range).toFixed(2) + " over " + intStr(M0.maturity_days) +
      " days. Older protocols have survived longer; an unknown listing date assumes " +
      M0.unknown_age_days + " days.</li>" +
      "<li><b>Breadth</b> — +" + M0.breadth_step + " per chain beyond the first, counting at most " +
      M0.breadth_max_extra + " extra chains. More chains means more surfaces a launch can land on.</li>";
    $("fittedNote").textContent = "Fitted vs stated: the size curve above is fitted on live comps; the three overlays are stated judgment, bounded as shown, not fitted. Changing them in the sandbox changes the display only — board.json is untouched.";
    $("setAside").textContent = "Accounting for every protocol whose record shows no token: " +
      intStr(D.board_size) + " ranked on the board + " + intStr(D.set_aside_size) +
      " set aside by the exclusion rule (wrappers, pools, or exchanges) + " +
      intStr(D.above_floor_off_watchlist) + " at or above the " + money(D.floor_usd) +
      " floor left off the watchlist under the house's parent-protocol rule = " +
      intStr(D.board_size + D.set_aside_size + D.above_floor_off_watchlist) + " pre-token protocols in all.";
    $("footer").innerHTML = "<p>Snapshot " + esc(D.as_of) + " · Source: " + esc(D.source) +
      " · Model " + esc(D.model_version) + ".</p>" +
      "<p>Implied values are model estimates from the snapshot's own figures — not prices, and not predictions that a token launches. “No token” means the record shows none.</p>";
    /* sandbox defaults */
    $("sbGrowth").value = M0.growth_weight;
    $("sbMaturity").value = M0.maturity_floor;
    $("sbBreadth").value = M0.breadth_step;
    $("sbGrowthVal").textContent = M0.growth_weight.toFixed(2);
    $("sbMaturityVal").textContent = M0.maturity_floor.toFixed(2);
    $("sbBreadthVal").textContent = M0.breadth_step.toFixed(3);
  }

  /* ---------- events ---------- */
  function clearFilters() {
    state.q = ""; state.cat = ""; state.chain = ""; state.wl = false;
    $("q").value = ""; $("cat").value = ""; $("chain").value = ""; $("wl").checked = false;
    renderAll();
    syncHash();
  }
  function bindEvents() {
    $("q").addEventListener("input", function () {
      state.q = $("q").value.trim().toLowerCase();
      renderAll();
      syncHash();
    });
    $("cat").addEventListener("change", function () { state.cat = $("cat").value; renderAll(); syncHash(); });
    $("chain").addEventListener("change", function () { state.chain = $("chain").value; renderAll(); syncHash(); });
    $("wl").addEventListener("change", function () { state.wl = $("wl").checked; renderAll(); syncHash(); });
    $("tabBoard").addEventListener("click", function () { setTab("board"); });
    $("tabLive").addEventListener("click", function () { setTab("live"); });
    document.querySelectorAll("[data-clear]").forEach(function (b) {
      b.addEventListener("click", clearFilters);
    });
    $("boardTable").querySelector("thead").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-key]");
      if (!b) return;
      var k = b.dataset.key;
      state.sort = state.sort.key === k
        ? { key: k, dir: -state.sort.dir }
        : { key: k, dir: (k === "rank" || k === "name") ? 1 : -1 };
      renderAll();
    });
    $("liveTable").querySelector("thead").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-key]");
      if (!b) return;
      var k = b.dataset.key;
      state.liveSort = state.liveSort.key === k
        ? { key: k, dir: -state.liveSort.dir }
        : { key: k, dir: k === "name" ? 1 : -1 };
      renderAll();
    });
    $("boardBody").addEventListener("click", function (ev) {
      var tr = ev.target.closest("tr[data-slug]");
      if (tr) openDetail(tr.dataset.slug, tr);
    });
    $("boardBody").addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      var tr = ev.target.closest("tr[data-slug]");
      if (!tr) return;
      ev.preventDefault();
      openDetail(tr.dataset.slug, tr);
    });
    $("scrim").addEventListener("click", closeDetail);
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closeDetail();
    });
    $("sbGrowth").addEventListener("input", onSandboxInput);
    $("sbMaturity").addEventListener("input", onSandboxInput);
    $("sbBreadth").addEventListener("input", onSandboxInput);
    $("sbReset").addEventListener("click", resetSandbox);
    window.addEventListener("resize", syncSticky);
  }

  /* ---------- boot ---------- */
  fillStatic();
  readHash();
  $("q").value = state.q;
  $("cat").value = state.cat;
  $("chain").value = state.chain;
  $("wl").checked = state.wl;
  bindEvents();
  setTab(state.tab);
  if (state.detail) openDetail(state.detail, null);
})();
