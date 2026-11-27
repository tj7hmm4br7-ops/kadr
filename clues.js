(() => {
  const screen = document.getElementById("cluesScreen");
  const find = selector => screen.querySelector(selector);
  const form = find("#cluesForm"), input = find("#cluesInput"), submit = form.querySelector("button");
  const status = find("#cluesStatus"), hint = find("#cluesHint"), still = find("#cluesStill");
  const replay = find("#cluesReplay"), history = find("#cluesHistory");
  const maxGuesses = 10, hintUnlock = 5;
  let catalog, loading, target, guesses = [], usedHint = false, ended = false;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function media(path, size) {
    if (!path) return "";
    return path.startsWith("img/") ? path : "https://image.tmdb.org/t/p/" + size + path;
  }

  function picture(path, size, className) {
    const image = element("img", "", className);
    image.alt = "";
    image.loading = "lazy";
    if (path) image.src = media(path, size);
    return image;
  }

  async function loadCatalog() {
    if (!loading) {
      loading = fetch("data/clue-films.json").then(response => {
        if (!response.ok) throw new Error("catalog");
        return response.json();
      }).then(entries => {
        if (!Array.isArray(entries) || entries.length !== 50) throw new Error("catalog");
        catalog = entries;
        find("#cluesTitles").replaceChildren(...entries.map(film => {
          const option = element("option");
          option.value = film.ru;
          option.label = String(film.year);
          return option;
        }));
      }).catch(error => { loading = null; throw error; });
    }
    await loading;
  }

  function refresh() {
    input.disabled = submit.disabled = !target || ended;
    hint.disabled = !target || ended || usedHint || guesses.length < hintUnlock;
    find("#cluesCount").textContent = guesses.length + " / " + maxGuesses;
    find("#cluesHintNote").textContent = usedHint ? "Кадр открыт" : guesses.length < hintUnlock ? "После пятой догадки" : "";
    replay.textContent = target ? "Играть ещё" : "Повторить загрузку";
    replay.classList.toggle("hidden", !!target && !ended);
  }

  function nextPuzzle() {
    const pool = catalog.filter(film => film.id !== target?.id);
    target = pool[Math.floor(Math.random() * pool.length)];
    guesses = [];
    ended = usedHint = false;
    history.replaceChildren();
    status.textContent = input.value = "";
    still.classList.add("hidden");
    still.removeAttribute("src");
    refresh();
  }

  function comparison(label, value, expected, format, near = 0) {
    if (value == null) return [label, "Нет данных", ""];
    if (expected == null) return [label, format(value), ""];
    if (value === expected) return [label, format(value) + " ✓", "clues-hit"];
    if (typeof value !== "number") return [label, format(value), ""];
    const arrow = expected > value ? " ↑" : " ↓";
    return [label, format(value) + arrow, Math.abs(expected - value) <= near ? "clues-near" : ""];
  }

  function people(label, credits, answer) {
    const section = element("section");
    const cards = element("div", "", "clues-people");
    const ids = new Set(answer.map(person => person.id));
    for (const person of credits) {
      const hit = ids.has(person.id);
      const card = element("div", "", hit ? "clues-person clues-hit" : "clues-person");
      if (person.photo) card.append(picture(person.photo, "w185"));
      card.append(element("strong", person.name), element("small", hit ? "✓ Совпало" : "Нет совпадения"));
      cards.append(card);
    }
    section.append(element("h4", label), cards);
    return section;
  }

  function renderGuess(film) {
    const article = element("article", "", "clues-attempt");
    const top = element("div", "", "clues-attempt-top");
    const body = element("div", "", "clues-attempt-data");
    const fields = element("dl", "", "clues-fields");
    const genreIds = new Set(target.genres.map(genre => genre.id));
    const genres = film.genres.filter(genre => genreIds.has(genre.id));
    const studioHit = !!film.studio && film.studio.id === target.studio?.id;
    const money = value => value >= 1e9
      ? "$" + (value / 1e9).toLocaleString("ru", { maximumFractionDigits: 2 }) + " млрд"
      : "$" + Math.round(value / 1e6) + " млн";
    const tiles = [
      comparison("Год", film.year, target.year, String, 5),
      ["Общие жанры", genres.map(genre => genre.name).join(", ") || "Нет совпадений", genres.length ? "clues-hit" : ""],
      ["Студия", film.studio ? film.studio.name + (studioHit ? " ✓" : "") : "Нет данных", studioHit ? "clues-hit" : ""],
      comparison("Мировые сборы", film.gross, target.gross, money, 1e8),
      comparison("Оценка зрителей", film.score, target.score, value => value + " / 100", 5),
      comparison("Возрастной рейтинг (США)", film.cert, target.cert, String),
    ];
    for (const [title, text, state] of tiles) {
      const tile = element("div", "", ["clues-field", state].filter(Boolean).join(" "));
      if (title === "Студия" && film.studio?.logo) {
        tile.classList.add("clues-studio");
        tile.append(picture(film.studio.logo, "w92"));
      }
      tile.append(element("dt", title), element("dd", text));
      fields.append(tile);
    }
    body.append(element("h3", film.ru), fields);
    top.append(picture(film.poster, "w342", "clues-poster"), body);
    const credits = element("div", "", "clues-credits");
    credits.append(people("Режиссёр", film.directors, target.directors), people("Актёрский состав", film.cast, target.cast));
    article.append(top, credits);
    history.prepend(article);
  }

  const normalize = text => text.toLowerCase().replaceAll("ё", "е").replace(/[^\p{L}\p{N}]+/gu, "");
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!target || ended) return;
    const value = normalize(input.value);
    const film = catalog.find(entry => [entry.ru, entry.en].some(title => normalize(title) === value));
    if (!film) { status.textContent = "Выбери фильм из списка под полем ввода."; return; }
    if (guesses.includes(film.id)) { status.textContent = "Этот фильм уже был."; return; }
    guesses.push(film.id);
    input.value = "";
    renderGuess(film);
    const won = film.id === target.id;
    ended = won || guesses.length >= maxGuesses;
    status.textContent = won ? "Угадано! «" + target.ru + "»" : ended ? "Загаданный фильм — «" + target.ru + "»" : "";
    refresh();
    if (!ended) input.focus();
  });

  hint.addEventListener("click", () => {
    if (hint.disabled) return;
    usedHint = true;
    still.src = media(target.still, "w780");
    still.classList.remove("hidden");
    refresh();
  });
  still.addEventListener("error", () => {
    if (!usedHint) return;
    still.classList.add("hidden");
    usedHint = false;
    status.textContent = "Кадр не загрузился. Попробуй ещё раз.";
    refresh();
  });
  replay.addEventListener("click", () => catalog ? nextPuzzle() : window.openClues());

  window.openClues = async () => {
    show("cluesScreen");
    if (target) return;
    status.textContent = "Загружаю фильмы…";
    replay.classList.add("hidden");
    try {
      await loadCatalog();
      if (!target) nextPuzzle();
    } catch {
      status.textContent = "Не удалось загрузить фильмы.";
      refresh();
    }
  };
})();
