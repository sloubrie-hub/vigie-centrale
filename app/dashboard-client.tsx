"use client";

import { useEffect, useMemo, useState } from "react";

type Theme = "Diablo 4" | "Hearthstone" | "Emploi" | "CIP & réglementation" | "Tech & gadgets";
type DataKind = "live";
type CollectionStatus = "running" | "completed" | "partial" | "failed";
type HealthStatus = "healthy" | "degraded" | "error" | "inactive";
type ReliabilityStatus = "reliable" | "degraded" | "unusable" | "pending" | "unknown";

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

const labels: Record<DataKind, string> = { live: "Donnée live" };

type SourceState = {
  id: string;
  source: string;
  theme: Theme | null;
  connectorType: string;
  active: boolean;
  status: HealthStatus;
  count: number;
  detail: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastStatus: "completed" | "failed" | null;
  consecutiveFailures: number;
  successRate: number | null;
  durationMs: number | null;
  recentError: string | null;
};

type Reliability = { status: ReliabilityStatus; analysisReady: boolean; reasons: string[] };

type InitialSnapshot = {
  items: Item[];
  sources: SourceState[];
  collection: {status:CollectionStatus;startedAt:string;finishedAt:string|null;sourceSucceeded:number;sourceFailed:number;errorMessage?:string|null}|null;
  reliability: { global: Reliability; employment: Reliability } | null;
  checkedAt: string | null;
};

const healthLabels: Record<HealthStatus, string> = {
  healthy: "SAINE", degraded: "DÉGRADÉE", error: "EN ERREUR", inactive: "INACTIVE",
};

const formatDate = (value: string | null) => value
  ? new Date(value).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
  : "Jamais";

const formatDuration = (value: number | null) => value === null
  ? "—"
  : value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`;

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
  const [reliability, setReliability] = useState(initialSnapshot.reliability);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(initialSnapshot.checkedAt);
  const items = liveItems;

  const refresh = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch("/api/veille", { cache: "no-store" });
      if (!response.ok) throw new Error("Collecte indisponible");
      const data = await response.json();
      setLiveItems(data.items || []); setSourceStates(data.sources || []); setCollection(data.collection || null); setReliability(data.reliability || null); setLastRefresh(data.checkedAt || null); setReadError(false);
    } catch { setReadError(true); }
    finally { if (showLoading) setLoading(false); }
  };

  useEffect(() => {
    if (collection?.status !== "running") return;
    const timer = window.setInterval(() => { void refresh(false); }, 5000);
    return () => window.clearInterval(timer);
  }, [collection?.status]);

  const collecting = collection?.status === "running";
  const healthCounts = sourceStates.reduce((counts, source) => ({ ...counts, [source.status]: counts[source.status] + 1 }), { healthy: 0, degraded: 0, error: 0, inactive: 0 });
  const statusLabel = loading ? "Chargement des données"
    : collecting ? "Acquisition en cours"
    : !collection ? "Aucune collecte connue"
    : collection?.status === "partial" ? "Partiellement à jour"
    : collection?.status === "failed" ? "Dernière collecte en erreur"
    : healthCounts.error > 0 ? `${healthCounts.healthy} sources à jour · ${healthCounts.error} en erreur`
    : healthCounts.degraded > 0 ? `${healthCounts.healthy} sources à jour · ${healthCounts.degraded} dégradée${healthCounts.degraded > 1 ? "s" : ""}`
    : `${healthCounts.healthy} sources à jour`;

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

          <section className={`integrity-banner ${collection?.status || "unknown"} ${reliability?.global.status === "degraded" || reliability?.global.status === "unusable" ? "health-warning" : ""}`}>
            <div className="shield">{collection?.status === "partial" || collection?.status === "failed" || reliability?.global.status === "degraded" || reliability?.global.status === "unusable" ? "!" : collecting ? "↻" : "✓"}</div><div><strong>{readError ? "Rafraîchissement indisponible — dernières données conservées" : collecting ? "Acquisition en cours — affichage des dernières données disponibles" : collection?.status === "partial" ? "Collecte partielle — certaines sources sont indisponibles" : collection?.status === "failed" ? "Dernière collecte en erreur — données précédentes conservées" : reliability?.global.status === "degraded" || reliability?.global.status === "unusable" ? "Données disponibles — santé des sources à vérifier" : collection ? "Dernière collecte complète" : "Aucune collecte connue"}</strong><p>{readError ? "L’échec de lecture ne supprime pas les éléments déjà affichés." : collecting ? "La navigation reste disponible pendant que les sources sont interrogées en arrière-plan." : collection?.status === "partial" ? `${collection.sourceSucceeded} sources réussies, ${collection.sourceFailed} en erreur. ${collection.errorMessage || "Les données précédentes restent consultables."}` : collection?.status === "failed" && collection.errorMessage ? collection.errorMessage : reliability?.global.reasons.length ? reliability.global.reasons.join(" · ") : "Le flux affiche les éléments déjà stockés dans Neon. L’ouverture de cette page ne déclenche aucune source externe."}</p></div>
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
          <section className="hero compact"><div><p className="eyebrow">OBSERVABILITÉ</p><h1>Sources & connexions</h1><p>Santé calculée sur les 10 dernières tentatives de chaque source.</p></div></section>
          <div className="source-summary"><div><strong>{healthCounts.healthy}</strong><span>sources saines</span></div><div><strong>{healthCounts.degraded}</strong><span>dégradées</span></div><div><strong>{healthCounts.error}</strong><span>en erreur</span></div><div><strong>{healthCounts.inactive}</strong><span>inactives</span></div></div>
          {sourceStates.length === 0 ? <div className="empty"><strong>Aucune source connue</strong><p>Le registre apparaîtra ici après sa migration et sa première initialisation.</p></div> : <section className="connection-grid">{sourceStates.map(state => <article key={state.id} className={`connection ${state.status}`}>
            <div className="connection-title"><span>{healthLabels[state.status]}</span><small>{state.connectorType.replace("_", " ")} · {state.theme || "Sans domaine"}</small></div>
            <strong>{state.source}</strong><p>{state.detail}</p>
            <dl><div><dt>Dernière tentative</dt><dd>{formatDate(state.lastAttemptAt)}</dd></div><div><dt>Dernier succès</dt><dd>{formatDate(state.lastSuccessAt)}</dd></div><div><dt>Éléments</dt><dd>{state.count}</dd></div><div><dt>Durée</dt><dd>{formatDuration(state.durationMs)}</dd></div><div><dt>Succès récents</dt><dd>{state.successRate === null ? "—" : `${state.successRate} %`}</dd></div><div><dt>Échecs consécutifs</dt><dd>{state.consecutiveFailures}</dd></div></dl>
            {state.recentError && <div className="source-error" title={state.recentError}>{state.recentError}</div>}
          </article>)}</section>}
          <section className="rules"><h2>Règles de santé</h2><div className="rule-grid health-rules"><article><b>01</b><strong>Saine</strong><p>Dernière tentative réussie et au moins 80 % de succès sur les 10 derniers runs.</p></article><article><b>02</b><strong>Dégradée</strong><p>Premier run absent, échec isolé après un succès, ou taux récent inférieur à 80 %.</p></article><article><b>03</b><strong>En erreur</strong><p>Deux échecs consécutifs, ou aucun succès connu après une tentative en échec.</p></article><article><b>04</b><strong>Inactive</strong><p>Désactivation volontaire : elle ne compte ni comme panne ni comme collecte manquante.</p></article></div></section>
        </div>}
      </section>
    </main>
  );
}
