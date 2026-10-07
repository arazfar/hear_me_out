(async () => {
  const verdict = document.querySelector("#verdict");
  try {
    const response = await fetch("/rehearsal.json", { cache: "no-store" });
    if (!response.ok) throw Error();
    const replay = await response.json(),
      names = new Map(replay.players.map((p) => [p.id, p.name]));
    const card = (parent, title, text) => {
      const article = document.createElement("article"),
        b = document.createElement("b"),
        p = document.createElement("p");
      b.textContent = title;
      p.textContent = text;
      article.append(b, p);
      document.querySelector(parent).append(article);
      return article;
    };
    verdict.replaceChildren();
    const h = document.createElement("h2");
    h.textContent = `${names.get(replay.winnerId)} won the rehearsal`;
    verdict.append(h);
    const topic = document.createElement("p");
    topic.textContent = replay.topic.proposition;
    verdict.append(topic);
    for (const result of replay.results)
      card(
        "#results",
        `Round ${result.round} · ${names.get(result.winnerId)}`,
        replay.players
          .map((p) => `${p.name}: ${(result.scores[p.id] / 4).toFixed(2)}`)
          .join(" / ") +
          ". " +
          result.reason,
      );
    for (const line of replay.judgeLines) card("#judge", "BONK", line);
    for (const transcript of replay.transcripts)
      card("#transcripts", names.get(transcript.playerId), transcript.text);
  } catch {
    verdict.textContent =
      "No saved rehearsal is available. Return to the live game; no scores have been invented.";
  }
})();
