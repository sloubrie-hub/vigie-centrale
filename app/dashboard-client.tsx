"use client";

import { useEffect, useMemo, useState } from "react";

type Theme = "Diablo 4" | "Hearthstone" | "Emploi" | "CIP & réglementation" | "Tech & gadgets";
type DataKind = "live";
type CollectionStatus = "running" | "completed" | "partial" | "failed";

type Item = {
  id: number | string;
  theme: Theme;
  kind: DataKind;
  date: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  priority: "Haute" | "Moyenne" | "À lire";
  tags: string[];
};

const themes: { name: Theme; icon: string; color: string }[] = [
  { name: "Diablo 4", icon: "♜", color: "red" },
  { name: "Hearthstone", icon: "✦", color: "amber" },
  { name: "Emploi", icon: "◎", color: "blue" },
  { name: "CIP & réglementation", icon: "§", color: "violet" },
  { name: "Tech & gadgets", icon: "⌁", color: "cyan" },
];

const sourceRows = [
  ["Blizzard News", "Diablo 4 / Hearthstone", "Live public", "RSS ou lecture officielle", "Prête à brancher"],
  ["YouTube — 7 créateurs", "Diablo 4 / Hearthstone", "Live public", "Flux officiels des chaînes", "Connecté"],
  ["France Travail", "Offres d’emploi", "Live officiel", "OAuth + API Offres v2", "Connecté"],
  ["Légifrance", "Réglementation", "Live public / API", "Flux officiels + PISTE", "À cadrer"],
  ["Missions Locales / collectivités", "CIP & emploi", "Live public", "Pages carrières et actualités", "À référencer"],
  ["Maxroll / créateurs experts", "Diablo 4", "Public, non officiel", "Sélection éditoriale", "À qualifier"],
  ["Sites tech reconnus", "Tech & gadgets", "Public, non officiel", "RSS + liste blanche", "À qualifier"],
];

const labels: Record<DataKind, string> = { live: "Donnée live" };

type InitialSnapshot = {
  items: Item[];
  sources: {id?:string;source:string;status:"live"|"api"|"error"|"running";count:number;detail:string;checkedAt?:string|null;durationMs?:number|null}[];
  collection: {status:CollectionStatus;startedAt:string;finishedAt:string|null;sourceSucceeded:number;sourceFailed:number;errorMessage?:string|null}|null;
  checkedAt: string | null;
};

export default function DashboardClient({ initialSnapshot }: { initialSnapshot: InitialSnapshot }) {
  const [activeTheme, setActiveTheme] = useState<Theme | "Tous">("Tous");
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<(number | string)[]>([]);
  const [view, setView] = useState<"feed" | "archive" | "sources">("feed");
  const [liveItems, setLiveItems] = useState<Item[]>(initialSnapshot.items);
  const [archivedItems, setArchivedItems] = useState<Item[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [sourceStates, setSourceStates] = useState(initialSnapshot.sources);
  const [collection, setCollection] = useState(initialSnapshot.collection);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(initialSnapshot.checkedAt);
  const items = liveItems;

  const refresh = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch("/api/veille", { cache: "no-store" });
      if (!response.ok) throw new Error("Collecte indisponible");
      const data = await response.json();
      setLiveItems(data.items || []); setSourceStates(data.sources || []); setCollection(data.collection || null); setLastRefresh(data.checkedAt || null);
    } catch { setSourceStates([{ source: "Collecteur Vigie", status: "error", count: 0, detail: "La collecte n’a pas répondu" }]); }
    finally { if (showLoading) setLoading(false); }
  };

  useEffect(() => {
    if (collection?.status !== "running") return;
    const timer = window.setInterval(() => { void refresh(false); }, 5000);
    return () => window.clearInterval(timer);
  }, [collection?.status]);

  const collecting = collection?.status === "running";
  const statusLabel = loading ? "Chargement des données"
    : collecting ? "Acquisition en cours"
    : collection?.status === "partial" ? "Partiellement à jour"
    : collection?.status === "failed" ? "Dernière collecte en erreur"
    : `${sourceStates.filter(s => s.status === "live").length} sources à jour`;

  const visible = useMemo(() => items.filter((item) => {
    const themeOk = activeTheme === "Tous" || item.theme === activeTheme;
    const q = query.trim().toLowerCase();
    const queryOk = !q || `${item.title} ${item.summary} ${item.tags.join(" ")}`.toLowerCase().includes(q);
    return themeOk && queryOk;
  }), [activeTheme, query, items]);

  const toggleSave = (id: number | string) => setSaved((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  const openArchive = async () => {
    setView("archive"); setArchiveLoading(true);
    try {
      const response = await fetch("/api/archive", { cache: "no-store" });
      const data = await response.json();
      setArchivedItems(data.items || []);
    } finally { setArchiveLoading(false); }
  };

  const archiveVisible = archivedItems.filter((item) => {
    const themeOk = activeTheme === "Tous" || item.theme === activeTheme;
    const q = query.trim().toLowerCase();
    return themeOk && (!q || `${item.title} ${item.summary} ${item.tags.join(" ")}`.toLowerCase().includes(q));
  });

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">V</span><div><strong>Vigie Centrale</strong><small>Veille personnelle</small></div></div>
        <nav aria-label="Navigation principale">
          <button className={view === "feed" ? "nav-item active" : "nav-item"} onClick={() => setView("feed")}><span>▦</span> Vue d’ensemble</button>
          <button className={view === "archive" ? "nav-item active" : "nav-item"} onClick={openArchive}><span>▤</span> Archives</button>
          <button className={view === "sources" ? "nav-item active" : "nav-item"} onClick={() => setView("sources")}><span>⌘</span> Sources & connexions</button>
        </nav>
        <div className="theme-nav">
          <p>THÈMES</p>
          <button className={activeTheme === "Tous" ? "theme-link selected" : "theme-link"} onClick={() => { setActiveTheme("Tous"); setView("feed"); }}><span className="dot all" />Tous les sujets <b>{items.length}</b></button>
          {themes.map((theme) => <button key={theme.name} className={activeTheme === theme.name ? "theme-link selected" : "theme-link"} onClick={() => { setActiveTheme(theme.name); setView("feed"); }}><span className={`dot ${theme.color}`} />{theme.name}<b>{items.filter(i => i.theme === theme.name).length}</b></button>)}
        </div>
        <div className="sidebar-status"><span className={collecting || loading ? "pulse loading" : collection?.status === "completed" ? "pulse live" : "pulse"} /><div><strong>{statusLabel}</strong><small>{lastRefresh ? `Dernière collecte : ${new Date(lastRefresh).toLocaleString("fr-FR", {day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}` : "Aucune collecte enregistrée"}</small></div></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand">Vigie Centrale</div>
          <label className="search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un sujet, un lieu, une source…" /></label>
          <div className="top-actions"><button title="Éléments enregistrés">☆ <span>{saved.length}</span></button><div className="avatar">SL</div></div>
        </header>

        {view === "feed" ? <div className="content">
          <section className="hero">
            <div><p className="eyebrow">{new Intl.DateTimeFormat("fr-FR", {weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date()).toUpperCase()}</p><h1>Votre veille, sans bruit.</h1><p>Un seul espace pour repérer ce qui mérite vraiment votre attention.</p></div>
            <div className="hero-metric"><span>À traiter</span><strong>{visible.filter(i => i.priority === "Haute").length}</strong><small>alertes prioritaires</small></div>
          </section>

          <section className={`integrity-banner ${collection?.status || "unknown"}`}>
            <div className="shield">{collection?.status === "partial" || collection?.status === "failed" ? "!" : collecting ? "↻" : "✓"}</div><div><strong>{collecting ? "Acquisition en cours — affichage des dernières données disponibles" : collection?.status === "partial" ? "Collecte partielle — certaines sources sont indisponibles" : collection?.status === "failed" ? "Dernière collecte en erreur — données précédentes conservées" : "Dernières données disponibles"}</strong><p>{collecting ? "La navigation reste disponible pendant que les sources sont interrogées en arrière-plan." : collection?.status === "partial" ? `${collection.sourceSucceeded} sources réussies, ${collection.sourceFailed} en erreur. ${collection.errorMessage || "Les données précédentes restent consultables."}` : collection?.status === "failed" && collection.errorMessage ? collection.errorMessage : "Le flux affiche les éléments déjà stockés dans Neon. L’ouverture de cette page ne déclenche aucune source externe."}</p></div>
          </section>

          <div className="filters" aria-label="Filtrer par type de donnée">
            <span className="chip active">Données live</span>
            <button className="refresh" onClick={() => void refresh()} disabled={loading}>{loading ? "Chargement…" : "Actualiser l’affichage ↻"}</button><span>{visible.length} élément{visible.length > 1 ? "s" : ""}</span>
          </div>

          <section className="feed">
            {visible.length === 0 && <div className="empty"><strong>Aucun résultat</strong><p>Modifiez les filtres ou votre recherche.</p></div>}
            {visible.map((item) => <article className={`watch-card ${item.kind}`} key={item.id}>
              <div className="card-rail"><span className={`source-state ${item.kind}`}>{labels[item.kind]}</span><button className={saved.includes(item.id) ? "save saved" : "save"} onClick={() => toggleSave(item.id)} aria-label="Enregistrer">{saved.includes(item.id) ? "★" : "☆"}</button></div>
              <div className="card-meta"><span>{item.theme}</span><time>{new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(item.date))}</time><em className={`priority p-${item.priority.toLowerCase().replace("à ","")}`}>{item.priority}</em></div>
              <h2>{item.title}</h2><p>{item.summary}</p>
              <div className="tags">{item.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
              <div className="card-footer"><span>Source : <strong>{item.source}</strong></span><a href={item.url} target="_blank" rel="noreferrer">Consulter la source ↗</a></div>
            </article>)}
          </section>
        </div> : view === "archive" ? <div className="content">
          <section className="hero compact"><div><p className="eyebrow">MÉMOIRE DE LA VEILLE</p><h1>Archives</h1><p>Les publications collectées restent consultables même après leur disparition des flux d’origine.</p></div><div className="hero-metric"><span>Conservés</span><strong>{archiveVisible.length}</strong><small>éléments archivés</small></div></section>
          <div className="filters"><span className="chip active">Historique persistant</span><button className="refresh" onClick={openArchive} disabled={archiveLoading}>{archiveLoading ? "Chargement…" : "Rafraîchir ↻"}</button><span>Utilisez la recherche et les thèmes pour filtrer</span></div>
          <section className="feed">
            {!archiveLoading && archiveVisible.length === 0 && <div className="empty"><strong>Archive vide</strong><p>Les premières publications seront conservées dès que la base PostgreSQL sera connectée.</p></div>}
            {archiveVisible.map((item) => <article className="watch-card live" key={`archive-${item.id}`}>
              <div className="card-rail"><span className="source-state live">Archivé</span><button className={saved.includes(item.id) ? "save saved" : "save"} onClick={() => toggleSave(item.id)} aria-label="Enregistrer">{saved.includes(item.id) ? "★" : "☆"}</button></div>
              <div className="card-meta"><span>{item.theme}</span><time>{new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(item.date))}</time><em className={`priority p-${item.priority.toLowerCase().replace("à ","")}`}>{item.priority}</em></div>
              <h2>{item.title}</h2><p>{item.summary}</p><div className="tags">{item.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
              <div className="card-footer"><span>Source : <strong>{item.source}</strong></span><a href={item.url} target="_blank" rel="noreferrer">Consulter la source ↗</a></div>
            </article>)}
          </section>
        </div> : <div className="content sources-view">
          <section className="hero compact"><div><p className="eyebrow">TRAÇABILITÉ</p><h1>Sources & connexions</h1><p>Le registre qui empêche de confondre collecte réelle et contenu de test.</p></div></section>
          <div className="source-summary"><div><strong>{sourceStates.filter(s => s.status === "live").length}</strong><span>sources live connectées</span></div><div><strong>{sourceStates.filter(s => s.status === "api").length}</strong><span>API à préparer</span></div><div><strong>{sourceStates.reduce((n,s) => n+s.count,0)}</strong><span>éléments collectés</span></div></div>
          <section className="connection-grid">{sourceStates.map(state => <article key={state.id || state.source} className={`connection ${state.status}`}><span>{state.status === "live" ? "À JOUR" : state.status === "running" ? "EN COURS" : state.status === "api" ? "INACTIVE" : "ERREUR"}</span><strong>{state.source}</strong><p>{state.detail}</p><b>{state.count} élément{state.count > 1 ? "s" : ""}{state.durationMs !== null && state.durationMs !== undefined ? ` · ${state.durationMs} ms` : ""}</b></article>)}</section>
          <section className="source-panel"><div className="panel-heading"><div><h2>Plan de branchement</h2><p>Ordre recommandé : sources officielles publiques, API emploi, puis sources éditoriales qualifiées.</p></div><span>Phase 1</span></div>
            <div className="source-table"><div className="table-row head"><span>Source</span><span>Thème</span><span>Statut des données</span><span>Accès</span><span>État</span></div>{sourceRows.map((row) => <div className="table-row" key={row[0]}>{row.map((cell, i) => <span key={i} data-label={["Source","Thème","Statut","Accès","État"][i]}>{cell}</span>)}</div>)}</div>
          </section>
          <section className="rules"><h2>Règles de confiance</h2><div className="rule-grid"><article><b>01</b><strong>Source avant résumé</strong><p>Chaque information conserve son lien, son éditeur et sa date de collecte.</p></article><article><b>02</b><strong>Officiel avant commentaire</strong><p>Les annonces officielles sont distinguées des analyses, guides et opinions.</p></article><article><b>03</b><strong>Démo toujours visible</strong><p>Une donnée de test garde son badge, même lorsqu’elle ressemble à une vraie actualité.</p></article></div></section>
        </div>}
      </section>
    </main>
  );
}
