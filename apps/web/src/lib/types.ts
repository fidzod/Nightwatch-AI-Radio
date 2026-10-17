// Row shapes mirroring packages/db/src/schema.ts. SQLite hands back numbers for
// INTEGER/REAL and strings for TEXT; booleans are 0/1.

export type Presenter = {
	id: number;
	name: string;
	station_role: string;
	tone_description: string;
	system_prompt: string;
	voice_archetype_notes: string;
	elevenlabs_voice_id: string | null;
	active: number;
	created_at: string;
	updated_at: string;
};

export type StationSettings = {
	id: number;
	/** ISO 3166-1 alpha-2, e.g. "GB". */
	country: string;
	updated_at: string;
};

export type Collection = {
	id: number;
	name: string;
	mood_tag: string | null;
	description: string | null;
	created_at: string;
	updated_at: string;
};

export type CollectionSummary = Collection & {
	track_count: number;
	total_seconds: number | null;
};

export type Track = {
	id: number;
	collection_id: number;
	file_path: string;
	title: string | null;
	artist: string | null;
	duration_seconds: number | null;
	sort_order: number;
	checksum: string | null;
	last_played_at: string | null;
	play_count: number;
	added_at: string;
};

export type ScheduleSlot = {
	id: number;
	recurrence_type: 'weekly' | 'date_override';
	day_of_week: number | null;
	specific_date: string | null;
	start_time: string;
	end_time: string;
	presenter_id: number;
	collection_id: number;
	priority: number;
	enabled: number;
};

export type ScheduleSlotView = ScheduleSlot & {
	presenter_name: string;
	collection_name: string;
};

export type StationState = {
	id: number;
	current_item_type: string | null;
	current_item_ref: string | null;
	/** Set only when current_item_type is 'music' — null for speech. */
	current_item_artist: string | null;
	current_item_started_at: string | null;
	current_item_duration: number | null;
	up_next_item_type: string | null;
	up_next_item_ref: string | null;
	/** Set only when up_next_item_type is 'music' — null for speech. */
	up_next_item_artist: string | null;
	current_presenter_id: number | null;
	current_collection_id: number | null;
	current_schedule_slot_id: number | null;
	last_heartbeat_at: string | null;
	updated_at: string;
};

/** What the live HUD renders — returned by the page load and /api/live alike. */
export type LivePayload = {
	snapshot: LiveSnapshot;
	recent: (Track & { collection_name: string })[];
	nowSlots: ScheduleSlotView[];
};

export type LiveSnapshot = {
	/** null when the station_state row doesn't exist yet (engine never ran). */
	state: StationState | null;
	presenter: Pick<Presenter, 'id' | 'name' | 'station_role'> | null;
	collection: Pick<Collection, 'id' | 'name' | 'mood_tag'> | null;
	slot: ScheduleSlotView | null;
	/** heartbeat within 30s of now */
	onAir: boolean;
	heartbeatAgeSeconds: number | null;
	serverTime: string;
	trackCount: number;
	collectionCount: number;
	presenterCount: number;
	slotCount: number;
};
