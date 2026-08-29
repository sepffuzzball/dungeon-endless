export type Role = 'user' | 'editor' | 'admin';
/** Seeded species names remain available for callers, while editor-defined names stay valid. */
export const SEEDED_SPECIES = ['Wolfen', 'Foxen', 'Gnoll', 'Human', 'Elf', 'Dwarf'] as const;
export type SeededSpecies = (typeof SEEDED_SPECIES)[number];
export type Species = string;
export type SkillName =
	'Athletics' | 'Knowledge' | 'Magic' | 'Persuasion' | 'Stealth' | 'Willpower';
export type RunStatus = 'active' | 'defeated' | 'abandoned';
export type LlmPurpose = 'prose' | 'interpretation' | 'summary' | 'suggestions';
export type RoomType = 'monster' | 'trap' | 'treasure' | 'rest' | 'boss';
export type ActionMethod = 'combat' | 'skill' | 'none';
export type NarrationStatus = 'pending' | 'streaming' | 'complete' | 'failed';

/** Editor-managed body build choices offered during character creation. */
export const BUILD_OPTIONS = [
	'Lean',
	'Sturdy',
	'Broad',
	'Lithe',
	'Thin',
	'Sickly',
	'Chubby',
	'Girly'
] as const;
export type BuildOption = (typeof BUILD_OPTIONS)[number];

/** Editor-managed height choices offered during character creation. */
export const HEIGHT_OPTIONS = ['Tiny', 'Short', 'Average', 'Tall', 'Gigantic'] as const;
export type HeightOption = (typeof HEIGHT_OPTIONS)[number];

export const SKILLS: SkillName[] = [
	'Athletics',
	'Knowledge',
	'Magic',
	'Persuasion',
	'Stealth',
	'Willpower'
];

export interface SafeUser {
	id: string;
	username: string;
	/** Older page/test fixtures may omit this; persisted users always receive the database default. */
	companyName?: string;
	role: Role;
	mustChangePassword: boolean;
	createdAt: string;
}

export interface SafeSession {
	id: string;
	userId: string;
	expiresAt: string;
}

export interface CharacterRow {
	id: string;
	userId: string;
	name: string;
	title: string;
	description: string;
	age: number;
	height: string;
	build: string;
	species: Species;
	className: string;
	level: number;
	body: number;
	mind: number;
	spirit: number;
	persistentGold: number;
	furthestFloor: number;
	active: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface RunRow {
	id: string;
	userId: string;
	characterId: string;
	status: RunStatus;
	seed: string;
	rulesVersion: number;
	roomNumber: number;
	version: number;
	hp: number;
	maxHp: number;
	brutality: number;
	debauchery: number;
	summary: string;
	roomType: string;
	roomData: RoomSnapshot;
	meta: Partial<RunMeta>;
	inventory: InventoryItem[];
	startedAt: Date;
	finishedAt: Date | null;
}

export interface TurnRow {
	id: string;
	runId: string;
	sequence: number;
	actionKey: string;
	actionText: string;
	intent: TurnIntent;
	roomSnapshot: RoomSnapshot;
	rolls: RollRecord[];
	outcome: TurnOutcome;
	narration: string;
	narrationStatus: NarrationStatus;
	narrationStartedAt: Date | null;
	narrationUpdatedAt: Date | null;
	turnSummary: string;
	createdAt: Date;
}

export interface RunMeta {
	startRoom: number;
	startLevel: number;
	gearBonus: number;
	/** Authoritative per-run stat allocation chosen at charter time. */
	allocatedBody: number;
	allocatedMind: number;
	allocatedSpirit: number;
}

export interface RoomSnapshot {
	type: RoomType;
	boss?: boolean;
	name?: string;
	description?: string;
	defense?: number;
	dc?: number;
	skill?: SkillName;
	rewards?: InventoryItem[];
	/** Legacy snapshots can contain only the original run metadata fields. */
	run?: Partial<RunMeta>;
}

/** Durable per-room narration state keyed by (runId, roomNumber). */
export interface RoomEntry {
	id: string;
	runId: string;
	roomNumber: number;
	runVersion: number;
	roomSnapshot: RoomSnapshot;
	prose: string;
	status: NarrationStatus;
	startedAt: string | null;
	updatedAt: string | null;
	createdAt: string;
}

export type MagicStat = 'attack' | 'defense' | 'body' | 'mind' | 'spirit' | 'skill' | 'general';

export interface InventoryItem {
	kind: 'magic' | 'draught' | 'valuable';
	name: string;
	description?: string;
	stat?: MagicStat;
	skill?: SkillName;
	value?: number;
}

export interface RollRecord {
	label: string;
	dice: number[];
	selected: number;
	/** Index of the kept die; older persisted rolls may omit it. */
	selectedIndex?: number;
	modifier: number;
	total: number;
	target: number;
	success: boolean;
	advantage: number;
}

export interface TurnIntent {
	method: ActionMethod;
	skill?: SkillName;
	advantage: number;
	customText?: string;
}

export interface TurnOutcome {
	result: 'success' | 'failure' | 'reward' | 'rest' | 'defeat';
	hpBefore: number;
	hpAfter: number;
	hpDelta: number;
	message: string;
	rewards?: InventoryItem[];
	injury?: string;
	gold?: number;
}

export interface SuggestedAction {
	label: string;
	detail: string;
	typed: string;
}

export interface DerivedStats {
	body: number;
	mind: number;
	spirit: number;
	instinct: number;
	hp: number;
	defense: number;
	attackBonus: number;
	skillValues: Record<SkillName, number>;
}

export interface LlmEndpointRow {
	id: string;
	name: string;
	purpose: LlmPurpose;
	baseUrl: string;
	model: string;
	apiKeyEnc: string | null;
	enabled: boolean;
	timeoutMs: number;
	createdAt: Date;
	updatedAt: Date;
}

/* Page-facing contracts. Database adapters can map persistence rows to these. */
export interface CharacterCard {
	id: string;
	name: string;
	title: string;
	species: string;
	className: string;
	level: number;
	body: number;
	mind: number;
	spirit: number;
	gold: number;
	furthestDepth: number;
	activeRunId?: string;
}

export interface RunSummary {
	id: string;
	characterName: string;
	depth: number;
	hp: number;
	maxHp: number;
	status: RunStatus;
}

export interface RoomView {
	number: number;
	title: string;
	kind: RoomType;
	prose: string;
	exits: string[];
	entryId: string | null;
	entryStatus: NarrationStatus | null;
}

export interface TerminalRoomEvent {
	kind: 'room';
	id: string;
	timestamp: string;
	roomNumber: number;
	title: string;
	roomKind: RoomType;
	prose: string;
	status: NarrationStatus;
}

export interface TerminalTurnEvent {
	kind: 'turn';
	id: string;
	timestamp: string;
	turn: number;
	action: string;
	narration: string;
	status: NarrationStatus;
	outcome: TurnOutcome;
	rolls: RollRecord[];
}

export type TerminalEvent = TerminalRoomEvent | TerminalTurnEvent;

export interface PendingNarration {
	kind: 'turn' | 'room';
	id: string;
}

export interface MonsterDefinition {
	id: string;
	name: string;
	tier: number;
	hp: number;
	defense: number;
	temperament: string;
	/** Longer flavour text describing appearance, tactics and voice. */
	description?: string;
	/** Optional flavour used when the run's debauchery calls for adult content. */
	debauchedDescription?: string;
	/** Whether the editor content is active for room generation. */
	enabled?: boolean;
}

export interface TrapDefinition {
	id: string;
	name: string;
	tier: number;
	target: number;
	skill: SkillName;
	consequence: string;
	/** Longer flavour text describing how the trap works. */
	description?: string;
	/** Whether the editor content is active for room generation. */
	enabled?: boolean;
}

export interface UserSummary {
	id: string;
	username: string;
	role: Role;
	status: 'active' | 'disabled';
	mustChangePassword: boolean;
	createdAt: string;
}

export interface EndpointSummary {
	id: string;
	name: string;
	purpose: LlmPurpose;
	baseUrl: string;
	model: string;
	enabled: boolean;
	timeoutMs: number;
}

export interface DashboardAchievement {
	key: string;
	name: string;
	description: string;
	unlocked: boolean;
}

/** Character profile as the play screen needs it. */
export interface PlayCharacter {
	name: string;
	title: string;
	className: string;
	species: string;
	level: number;
	age: number;
	hp: number;
	maxHp: number;
	body: number;
	mind: number;
	spirit: number;
	defense: number;
	attackBonus: number;
	gold: number;
}

/** Data contract for the play page. */
export interface PlayView {
	runId: string;
	status: RunStatus;
	room: RoomView;
	character: PlayCharacter;
	terminal: TerminalEvent[];
	pendingNarrations: PendingNarration[];
	suggestions: SuggestedAction[];
	expectedVersion: number;
	actionKey: string;
	actionKeys: string[];
	inventory: InventoryItem[];
	summary: string;
	characterName: string;
}
