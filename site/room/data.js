// The holo war room's cast (owner 2026-11-19: the prototype approved, "Sinkron dengan room nyata"). Public only: a
// one-word name, a role in plain words and what each analyst reads. Nothing internal, no stance, no confidence, no
// decision, no price. What the rooms said comes live from GET /api/public/warroom-scene, never from this file.
// Each analyst's role says what it reads (owner 2026-11-19, the homepage redesign: a distinct role per agent, not
// one shared line). Indicator names stay capitalised; everything else reads as a sentence.
const PROPER = /^(Prophet|GMI|Supertrend|Camarilla|Hurst)\b/;
const lower = (s) => s.split(' ').map((w, i) => (i === 0 && !PROPER.test(w) && !/^[A-Z]{2,}/.test(w) ? w.charAt(0).toLowerCase() + w.slice(1) : w)).join(' ');
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const reads = (id) => `Reads ${list(READS[id].map(lower))}.`;
const leads = (candle) => `Brings the ${candle} candle to the table and leads that meeting.`;

/** What each analyst at the table reads, whatever the room. */
export const READS = {
  news: ['US dollar strength', 'Gold ETF flows', 'Rate expectations'],
  risk: ['Volatility', 'Supertrend and average true range'],
  prophet: ['Prophet structure', 'Prophet cycles', 'Fast oscillator'],
  trade_management: ['Prophet cycles', 'Price z-score', 'Order-block filter'],
  kinetic_engine: ['Adaptive channel angle', 'Market entropy', 'Trend angle'],
  fabio_amt: ['Value area range', 'Footprint order flow'],
  chronos_matrix: ['Daily pivot central range', 'Weekly pivot central range'],
  tactical_muscles: ['Momentum percentile rank'],
  decision_matrix: ['Prophet', 'GMI', 'Volume profile'],
  supertrend: ['Supertrend and average true range'],
  order_blocks: ['Active order blocks', 'Order-block filter', 'Mitigation zones'],
  technical: ['The last closed candles', 'Recent price trend'],
  projection: ['Chart pattern breakouts', 'Probability cone', 'Trendlines'],
  interstellar_eyes: ['Daily Camarilla levels', 'Weekly Camarilla levels'],
  macro_aether: ['Multi-timeframe z-score', 'Weighted Hurst exponent'],
  aegis_footprint: ['Footprint order flow', 'Price action structure', 'Momentum alignment']
};

export const PEOPLE = [
  // the analysts at the table, in every timeframe's room
  { id: 'news', dept: 'hall', name: 'news', title: 'News Analyst', role: 'The fundamental news of the last 24 hours and the headlines behind its reading.' },
  { id: 'technical', dept: 'hall', name: 'technical', title: 'Technical Analyst', role: 'Price action only: the closed candles of the chart under discussion.' },
  { id: 'risk', dept: 'hall', name: 'risk', title: 'Risk Manager', role: 'Risk only: volatility, confirmation and what would invalidate a move.' },
  { id: 'projection', dept: 'hall', name: 'projection', title: 'Projection Agent', role: 'Where a move projects: the probability cone, trendlines and chart patterns.' },
  { id: 'prophet', dept: 'hall', name: 'prophet', title: 'Prophet', role: reads('prophet') },
  { id: 'trade_management', dept: 'hall', name: 'tradeMgmt', title: 'Trade Management', role: reads('trade_management') },
  { id: 'interstellar_eyes', dept: 'hall', name: 'interstellar', title: 'The Interstellar Eyes', role: reads('interstellar_eyes') },
  { id: 'kinetic_engine', dept: 'hall', name: 'kinetic', title: 'Kinetic Engine', role: reads('kinetic_engine') },
  { id: 'fabio_amt', dept: 'hall', name: 'fabioAMT', title: 'Fabio AMT Sensors', role: reads('fabio_amt') },
  { id: 'chronos_matrix', dept: 'hall', name: 'chronos', title: 'Chronos Matrix', role: reads('chronos_matrix') },
  { id: 'tactical_muscles', dept: 'hall', name: 'tactical', title: 'Tactical Muscles', role: reads('tactical_muscles') },
  { id: 'macro_aether', dept: 'hall', name: 'macroAether', title: 'Macro & Aether Sensors', role: reads('macro_aether') },
  { id: 'decision_matrix', dept: 'hall', name: 'matrix', title: 'Matrix Analyst', role: reads('decision_matrix') },
  { id: 'supertrend', dept: 'hall', name: 'supertrend', title: 'Supertrend', role: reads('supertrend') },
  { id: 'aegis_footprint', dept: 'hall', name: 'aegis', title: 'Aegis Footprint Matrix', role: reads('aegis_footprint') },
  { id: 'order_blocks', dept: 'hall', name: 'orderBlocks', title: 'Order Blocks', role: reads('order_blocks') },
  // the leaders, each in its own bay; the Moderator joins every meeting
  { id: 'm15', dept: 'lead', name: 'lead15m', title: '15m Lead', role: leads('15-minute') },
  { id: 'h1', dept: 'lead', name: 'lead1H', title: '1H Lead', role: leads('hourly') },
  { id: 'h4', dept: 'lead', name: 'lead4H', title: '4H Lead', role: leads('4-hour') },
  { id: 'd1', dept: 'lead', name: 'lead1D', title: '1D Lead', role: leads('daily') },
  { id: 'moderator', dept: 'lead', name: 'moderator', title: 'Moderator', role: 'Facilitates every meeting and writes its conclusion.' },
  // research: the macro desk and the news thread
  { id: 'calendar', dept: 'research', name: 'calendar', title: 'Calendar Agent', role: 'The scheduled US events and their projected effect on gold.' },
  { id: 'dollar', dept: 'research', name: 'dollar', title: 'Dollar Analyst', role: 'The US Dollar Index: its recent move and how tightly it has moved against gold.' },
  { id: 'rates', dept: 'research', name: 'rates', title: 'Rates Analyst', role: 'The US 10-year yield and what it means for the cost of holding gold.' },
  { id: 'silver', dept: 'research', name: 'metals', title: 'Metals Analyst', role: "Silver: whether it confirms or contradicts gold's move." },
  { id: 'oil', dept: 'research', name: 'oil', title: 'Oil Analyst', role: 'WTI crude oil and the geopolitical headlines.' },
  { id: 'correlation', dept: 'research', name: 'correlation', title: 'Correlation Analyst', role: 'Whether the usual links between gold, the dollar, yields, silver and oil hold now.' },
  { id: 'syn_analyst', dept: 'research', name: 'analyst', title: 'Analyst', role: 'First reader of the news thread.' },
  { id: 'syn_counselor', dept: 'research', name: 'counselor', title: 'Counselor', role: 'Challenges the Analyst in the news thread.' },
  { id: 'syn_reasoner', dept: 'research', name: 'reasoner', title: 'Reasoner', role: 'Writes the synthesis from the Analyst and the Counselor.' },
  // content studio
  { id: 'cta_editor', dept: 'content', name: 'ctaEditor', title: 'CTA Editor', role: 'Drafts the public posts from the analysis.' },
  { id: 'cta_guardian', dept: 'content', name: 'ctaGuardian', title: 'CTA Content Guardian', role: 'Checks every post against the content rules before it is approved.' },
  // knowledge (they ride the compass ring)
  { id: 'ae_auditor', dept: 'knowledge', name: 'aetherAuditor', title: 'Aether Auditor', role: 'Reviews past readings and finds repeated mistakes.' },
  { id: 'ae_calibrator', dept: 'knowledge', name: 'calibrator', title: 'Aether Calibrator', role: 'Proposes parameter candidates within reviewed ranges.' },
  { id: 'ae_curator', dept: 'knowledge', name: 'curator', title: 'Aether Curator', role: 'Keeps the ledger of what was learned.' },
  { id: 'ae_guardian', dept: 'knowledge', name: 'aetherGuardian', title: 'Aether Guardian', role: 'Checks what each agent said against its role and the doctrine.' },
  { id: 'ae_council', dept: 'knowledge', name: 'council', title: 'Knowledge Council', role: 'Meets daily and compares the doctrine with what was learned.' },
  // platform operations (they patrol as drones)
  { id: 'supervisor', dept: 'ops', name: 'supervisor', title: 'Platform Supervisor', role: 'Watches the platform and proposes recovery plans for a person to approve.' },
  { id: 'auditor', dept: 'ops', name: 'auditor', title: 'Platform Auditor', role: 'Verifies the audit trail every hour.' },
  { id: 'signal_analyst', dept: 'ops', name: 'digest', title: 'Digest Analyst', role: 'Reads the rooms and the macro context every hour and writes a digest.' },
  { id: 'adr_steward', dept: 'ops', name: 'steward', title: 'Records Steward', role: 'Keeps the design records in step with what runs.' },
  { id: 'evolver', dept: 'ops', name: 'evolver', title: 'Evolver', role: 'Turns approved proposals into change requests.' },
  { id: 'audit_ledger', dept: 'ops', name: 'ledger', title: 'Audit Ledger', role: 'Summarizes the audit trail.' },
  { id: 'orchestrator', dept: 'ops', name: 'orchestrator', title: 'Release Orchestrator', role: 'Summarizes release readiness.' },
  { id: 'drift', dept: 'ops', name: 'drift', title: 'Drift Detector', role: 'Compares what should run with what runs.' },
  { id: 'platform_api', dept: 'ops', name: 'api', title: 'Platform API', role: 'Summarizes the control plane.' },
  { id: 'registry', dept: 'ops', name: 'registry', title: 'Service Registry', role: 'Keeps the list of services.' },
  { id: 'policy', dept: 'ops', name: 'policy', title: 'Policy Engine', role: 'Explains why a policy allowed or refused something.' },
  { id: 'recovery', dept: 'ops', name: 'recovery', title: 'Recovery Manager', role: 'Summarizes recovery plans and their approvals.' }
];

/** The navigator's groups, in order. */
export const DEPTS = [
  { id: 'hall', label: 'At the table' },
  { id: 'lead', label: 'Leaders' },
  { id: 'research', label: 'Research' },
  { id: 'content', label: 'Content studio' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'ops', label: 'Platform' }
];


/** The four meetings: who leads, who joins, and the room each follows (GET /api/public/warroom-scene `rooms`). */
export const MEETINGS = {
  m15: { source: '15m', label: '15m meeting', short: '15m', lead: 'm15', leaders: ['m15'], cadence: 'every 15 minutes' },
  h1: { source: '1h', label: '1H meeting', short: '1h', lead: 'h1', leaders: ['h1', 'm15'], cadence: 'every hour' },
  h4: { source: '4h', label: '4H meeting', short: '4h', lead: 'h4', leaders: ['h4', 'h1', 'm15'], cadence: 'every 4 hours' },
  d1: { source: '1d', label: 'Daily meeting', short: '1d', lead: 'd1', leaders: ['d1', 'h4', 'h1', 'm15'], everyone: true, cadence: 'daily at 22:00 UTC' }
};
