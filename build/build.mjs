// Собирает данные о фильмах и картинки, чтобы сайт не ходил в TMDB из браузера игрока.
// Запускается в GitHub Actions (там TMDB доступен), результат кладётся в data/ и img/.
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

const KEY = process.env.TMDB_KEY;
const API = "https://api.themoviedb.org/3";
const FRAMES_MAX = 8;          // сколько кадров храним на фильм
const FRAME_W = "w780", POSTER_W = "w342";
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- списки берём прямо из index.html, чтобы не было двух копий ---
const html = await readFile("index.html", "utf8");
const start = html.indexOf("const LISTS = {");
const end = html.indexOf("\n};", start);
const LISTS = new Function("return " + html.slice(start + "const LISTS = ".length, end + 2))();

async function tmdb(path, params = {}) {
  const q = new URLSearchParams({ api_key: KEY, ...params });
  for (let a = 0; a < 5; a++) {
    const r = await fetch(`${API}${path}?${q}`);
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    await sleep(1000 * (a + 1));
  }
  throw new Error("TMDB " + path);
}

// --- точно та же логика поиска, что и на сайте ---
const normT = t => (t || "").toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, "");
function pickBest(results, year, query) {
  const near = results.filter(r => r.release_date && Math.abs(+r.release_date.slice(0, 4) - year) <= 1);
  const q = normT(query);
  const exact = near.filter(r => normT(r.title) === q || normT(r.original_title) === q);
  const pool = exact.length ? exact : near;
  return pool.sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))[0] || null;
}
const ckOf = ([title, year, imdbId, ruTitle, tmdbId]) =>
  tmdbId ? "t" + tmdbId : imdbId || (ruTitle ? "kp|" + ruTitle + "|" + year : title + "|" + year);
async function resolve([title, year, imdbId, ruTitle]) {
  let m;
  if (imdbId) { const d = await tmdb(`/find/${imdbId}`, { external_source: "imdb_id", language: "ru-RU" }); m = d && d.movie_results[0]; }
  let first = null;
  for (const q of [title, ruTitle].filter((x, i, a) => x && a.indexOf(x) === i)) {
    if (m) break;
    const d = await tmdb("/search/movie", { query: q, language: "ru-RU" });
    first = first || d.results[0];
    m = pickBest(d.results, year, q);
  }
  m = m || first;
  if (!m) return null;
  if (!year && m.release_date) year = +m.release_date.slice(0, 4);
  return { id: m.id, ru: ruTitle || m.title, orig: m.original_title, en: title || m.original_title, year, genres: m.genre_ids || [],
    poster: m.poster_path, bd: m.backdrop_path, imdb: imdbId || null, lang: m.original_language, votes: m.vote_count || 0 };
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}
const exists = p => access(p).then(() => true, () => false);
async function grab(url, out, w) {
  if (await exists(out)) return true;
  for (let a = 0; a < 4; a++) {
    const r = await fetch(url);
    if (r.ok) {
      const tmp = out + ".src";
      await writeFile(tmp, Buffer.from(await r.arrayBuffer()));
      await run("cwebp", ["-quiet", "-q", "72", "-resize", String(w), "0", tmp, "-o", out]);
      await run("rm", [tmp]);
      return true;
    }
    if (r.status === 404) return false;
    await sleep(1000 * (a + 1));
  }
  return false;
}

// 1. находим все фильмы
const entries = [];
for (const name of Object.keys(LISTS)) for (const e of LISTS[name]) entries.push(e);
const byCk = {};
await pool(entries, 6, async e => {
  const ck = ckOf(e);
  if (byCk[ck] !== undefined) return;
  byCk[ck] = null;
  try { byCk[ck] = await resolve(e); } catch (err) { console.log("не нашли", e[0], err.message); }
});
const films = Object.values(byCk).filter(Boolean);
const uniq = [...new Map(films.map(f => [f.id, f])).values()];
console.log("записей", Object.keys(byCk).length, "уникальных фильмов", uniq.length);

// 2. кадры, IMDb, картинки
const extra = {};
let done = 0;
await pool(uniq, 6, async f => {
  const dir = `img/${f.id}`;
  await mkdir(dir, { recursive: true });
  const imgs = await tmdb(`/movie/${f.id}/images`, { include_image_language: "null" });
  let all = ((imgs && imgs.backdrops) || []).map(b => b.file_path);
  if (all.length > FRAMES_MAX) all = all.filter(p => p !== f.bd);
  const frames = [];
  for (const p of all.slice(0, FRAMES_MAX)) {
    const out = `${dir}/${frames.length}.webp`;
    if (await grab(`https://image.tmdb.org/t/p/${FRAME_W}${p}`, out, 780)) frames.push(out);
  }
  let poster = "";
  if (f.poster && await grab(`https://image.tmdb.org/t/p/${POSTER_W}${f.poster}`, `${dir}/p.webp`, 342)) poster = `${dir}/p.webp`;
  let imdb = f.imdb;
  if (!imdb) { const e = await tmdb(`/movie/${f.id}/external_ids`); imdb = (e && e.imdb_id) || ""; }
  extra[f.id] = { frames, poster, imdb };
  if (++done % 50 === 0) console.log("картинки", done, "/", uniq.length);
});

// 3. итоговый файл: ключи те же, что в кэше сайта
const out = {};
for (const [ck, f] of Object.entries(byCk)) {
  if (!f) continue;
  const x = extra[f.id];
  const { bd, ...rest } = f;
  out[ck] = { ...rest, poster: x.poster, frames: x.frames, imdb: f.imdb || x.imdb };
}
await mkdir("data", { recursive: true });
await writeFile("data/films.json", JSON.stringify({ v: 1, films: out }));
console.log("готово:", Object.keys(out).length, "записей");
