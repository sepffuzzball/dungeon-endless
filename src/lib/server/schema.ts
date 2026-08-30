import { sql } from 'drizzle-orm';
import {
	boolean,
	bigint,
	check,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import {
	SEEDED_SPECIES,
	type InventoryItem,
	type RoomSnapshot,
	type RollRecord,
	type RunMeta,
	type TurnIntent,
	type TurnOutcome
} from '../types';

export const roleEnum = pgEnum('user_role', ['user', 'editor', 'admin']);
export const runStatusEnum = pgEnum('run_status', ['active', 'defeated', 'abandoned']);
export const runPhaseEnum = pgEnum('run_phase', [
	'ready',
	'awaiting_loot',
	'awaiting_failure',
	'awaiting_proceed'
]);
export const roomTypeEnum = pgEnum('room_type', ['monster', 'trap', 'treasure', 'rest', 'boss']);
export const llmPurposeEnum = pgEnum('llm_purpose', [
	'prose',
	'interpretation',
	'summary',
	'suggestions'
]);
/** Compatibility export for existing selectors; character snapshots themselves use unrestricted text. */
export const speciesEnum = { enumValues: [...SEEDED_SPECIES] as readonly string[] };
export const narrationStatusEnum = pgEnum('narration_status', [
	'pending',
	'streaming',
	'complete',
	'failed'
]);
export const skillEnum = pgEnum('skill', [
	'Athletics',
	'Knowledge',
	'Magic',
	'Persuasion',
	'Stealth',
	'Willpower'
]);

export const users = pgTable(
	'users',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		username: text('username').notNull(),
		companyName: text('company_name').notNull().default('The Endless Company'),
		companyGold: bigint('company_gold', { mode: 'number' }).notNull().default(0),
		brutality: integer('brutality').notNull().default(3),
		debauchery: integer('debauchery').notNull().default(3),
		passwordHash: text('password_hash').notNull(),
		role: roleEnum('role').notNull().default('user'),
		disabled: boolean('disabled').notNull().default(false),
		mustChangePassword: boolean('must_change_password').notNull().default(false),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('users_username_unique').on(table.username),
		check('users_username_normalized', sql`username = lower(username)`),
		check('users_company_gold_nonnegative', sql`${table.companyGold} >= 0`),
		check('users_company_gold_safe_integer', sql`${table.companyGold} <= 9007199254740991`),
		check('users_brutality_range', sql`${table.brutality} between 1 and 5`),
		check('users_debauchery_range', sql`${table.debauchery} between 1 and 5`)
	]
);

export const sessions = pgTable(
	'sessions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		tokenHash: text('token_hash').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
		index('sessions_user_id_idx').on(table.userId)
	]
);

export const characters = pgTable(
	'characters',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		title: text('title').notNull().default(''),
		description: text('description').notNull().default(''),
		imageUrl: text('image_url'),
		age: integer('age').notNull(),
		height: text('height').notNull().default(''),
		build: text('build').notNull().default(''),
		species: text('species').notNull(),
		className: text('class_name').notNull(),
		level: integer('level').notNull().default(1),
		body: integer('body').notNull(),
		mind: integer('mind').notNull(),
		spirit: integer('spirit').notNull(),
		persistentGold: integer('persistent_gold').notNull().default(0),
		gearBonus: integer('gear_bonus').notNull().default(0),
		maxStartRoom: integer('max_start_room').notNull().default(1),
		furthestFloor: integer('furthest_floor').notNull().default(0),
		active: boolean('active').notNull().default(false),
		retiredAt: timestamp('retired_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('characters_user_id_idx').on(table.userId),
		check('characters_age_range', sql`${table.age} between 1 and 999`),
		check('characters_level_range', sql`${table.level} between 1 and 10`),
		check('characters_body_range', sql`${table.body} between 0 and 4`),
		check('characters_mind_range', sql`${table.mind} between 0 and 4`),
		check('characters_spirit_range', sql`${table.spirit} between 0 and 4`),
		check('characters_gear_bonus_range', sql`${table.gearBonus} between 0 and 3`),
		check('characters_max_start_room_range', sql`${table.maxStartRoom} between 1 and 1000`),
		check(
			'characters_valid_stat_allocation',
			sql`${table.body} + ${table.mind} + ${table.spirit} = ${table.level}
				and ((${table.level} < 10 and greatest(${table.body}, ${table.mind}, ${table.spirit}) <= 3)
				or (${table.level} = 10 and greatest(${table.body}, ${table.mind}, ${table.spirit}) <= 4
				and ((${table.body} = 4)::int + (${table.mind} = 4)::int + (${table.spirit} = 4)::int) <= 1))`
		)
	]
);

export const monsters = pgTable('monsters', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	tier: integer('tier').notNull().default(1),
	hp: integer('hp').notNull().default(8),
	defense: integer('defense').notNull(),
	temperament: text('temperament').notNull().default(''),
	description: text('description').notNull().default(''),
	debauchedDescription: text('debauched_description').notNull().default(''),
	enabled: boolean('enabled').notNull().default(true),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const traps = pgTable('traps', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	tier: integer('tier').notNull().default(1),
	target: integer('target').notNull().default(8),
	skill: skillEnum('skill').notNull(),
	consequence: text('consequence').notNull().default(''),
	description: text('description').notNull().default(''),
	enabled: boolean('enabled').notNull().default(true),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/* ------------------------------------------------------------------ *
 * Editor-managed species and calling definitions
 * ------------------------------------------------------------------ */

export const speciesDefinitions = pgTable(
	'species_definitions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		nameNormalized: text('name_normalized').notNull(),
		description: text('description').notNull().default(''),
		enabled: boolean('enabled').notNull().default(true),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('species_definitions_name_normalized_unique').on(table.nameNormalized),
		index('species_definitions_enabled_idx').on(table.enabled),
		check('species_definitions_name_normalized_check', sql`name_normalized = lower(name)`)
	]
);

export const callingDefinitions = pgTable(
	'calling_definitions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		nameNormalized: text('name_normalized').notNull(),
		description: text('description').notNull().default(''),
		enabled: boolean('enabled').notNull().default(true),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('calling_definitions_name_normalized_unique').on(table.nameNormalized),
		index('calling_definitions_enabled_idx').on(table.enabled),
		check('calling_definitions_name_normalized_check', sql`name_normalized = lower(name)`)
	]
);

export const runs = pgTable(
	'runs',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		characterId: uuid('character_id')
			.notNull()
			.references(() => characters.id, { onDelete: 'cascade' }),
		status: runStatusEnum('status').notNull().default('active'),
		phase: runPhaseEnum('phase').notNull().default('ready'),
		seed: text('seed').notNull(),
		rulesVersion: integer('rules_version').notNull().default(1),
		roomNumber: integer('room_number').notNull().default(1),
		version: integer('version').notNull().default(1),
		hp: integer('hp').notNull(),
		maxHp: integer('max_hp').notNull(),
		brutality: integer('brutality').notNull().default(0),
		debauchery: integer('debauchery').notNull().default(0),
		summary: text('summary').notNull().default(''),
		roomType: roomTypeEnum('room_type').notNull().default('treasure'),
		roomData: jsonb('room_data').$type<RoomSnapshot>().notNull(),
		meta: jsonb('meta')
			.$type<Partial<RunMeta>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		inventory: jsonb('inventory')
			.$type<InventoryItem[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
		finishedAt: timestamp('finished_at', { withTimezone: true })
	},
	(table) => [
		index('runs_user_id_idx').on(table.userId),
		index('runs_character_id_idx').on(table.characterId),
		uniqueIndex('runs_one_active_per_character')
			.on(table.characterId)
			.where(sql`status = 'active'`)
	]
);

export const turns = pgTable(
	'turns',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		runId: uuid('run_id')
			.notNull()
			.references(() => runs.id, { onDelete: 'cascade' }),
		sequence: integer('sequence').notNull(),
		actionKey: text('action_key').notNull(),
		actionText: text('action_text').notNull().default(''),
		intent: jsonb('intent').$type<TurnIntent>().notNull(),
		roomSnapshot: jsonb('room_snapshot').$type<RoomSnapshot>().notNull(),
		rolls: jsonb('rolls')
			.$type<RollRecord[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		outcome: jsonb('outcome').$type<TurnOutcome>().notNull(),
		narration: text('narration').notNull().default(''),
		narrationStatus: narrationStatusEnum('narration_status').notNull().default('complete'),
		narrationStartedAt: timestamp('narration_started_at', { withTimezone: true }),
		narrationUpdatedAt: timestamp('narration_updated_at', { withTimezone: true }),
		turnSummary: text('turn_summary').notNull().default(''),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('turns_run_id_idx').on(table.runId),
		uniqueIndex('turns_run_id_action_key_unique').on(table.runId, table.actionKey),
		uniqueIndex('turns_run_sequence_action_key_unique').on(
			table.runId,
			table.sequence,
			table.actionKey
		)
	]
);

export const roomEntries = pgTable(
	'room_entries',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		runId: uuid('run_id')
			.notNull()
			.references(() => runs.id, { onDelete: 'cascade' }),
		/** Idempotency key bound later to roomEntries.runVersion; null for initial entries. */
		commandKey: uuid('command_key'),
		roomNumber: integer('room_number').notNull(),
		runVersion: integer('run_version').notNull(),
		roomSnapshot: jsonb('room_snapshot').$type<RoomSnapshot>().notNull(),
		prose: text('prose').notNull().default(''),
		status: narrationStatusEnum('status').notNull().default('pending'),
		startedAt: timestamp('started_at', { withTimezone: true }),
		updatedAt: timestamp('updated_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('room_entries_run_id_idx').on(table.runId),
		uniqueIndex('room_entries_run_id_room_number_unique').on(table.runId, table.roomNumber),
		uniqueIndex('room_entries_run_id_command_key_unique').on(table.runId, table.commandKey),
		check('room_entries_room_number_positive', sql`room_number > 0`),
		check('room_entries_run_version_nonnegative', sql`run_version >= 0`)
	]
);

export const llmEndpoints = pgTable('llm_endpoints', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	purpose: llmPurposeEnum('purpose').notNull().default('prose'),
	baseUrl: text('base_url').notNull(),
	model: text('model').notNull().default(''),
	apiKeyEnc: text('api_key_enc'),
	enabled: boolean('enabled').notNull().default(true),
	timeoutMs: integer('timeout_ms').notNull().default(20000),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const achievements = pgTable(
	'achievements',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		key: text('key').notNull(),
		name: text('name').notNull(),
		description: text('description').notNull().default(''),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [uniqueIndex('achievements_key_unique').on(table.key)]
);

export const userAchievements = pgTable(
	'user_achievements',
	{
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		achievementId: uuid('achievement_id')
			.notNull()
			.references(() => achievements.id, { onDelete: 'cascade' }),
		unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [primaryKey({ columns: [table.userId, table.achievementId] })]
);

export type User = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type SessionInsert = typeof sessions.$inferSelect;
export type Character = typeof characters.$inferSelect;
export type Monster = typeof monsters.$inferSelect;
export type Trap = typeof traps.$inferSelect;
export type SpeciesDefinition = typeof speciesDefinitions.$inferSelect;
export type CallingDefinition = typeof callingDefinitions.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type Turn = typeof turns.$inferSelect;
export type RoomEntry = typeof roomEntries.$inferSelect;
export type LlmEndpoint = typeof llmEndpoints.$inferSelect;
export type Achievement = typeof achievements.$inferSelect;
export type UserAchievement = typeof userAchievements.$inferSelect;
