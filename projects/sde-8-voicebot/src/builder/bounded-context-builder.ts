import { ContextItem } from '../schemas/context.schema';

export interface BoundedContextConfig {
  /** Maximum token budget allowed in final aggregated context (default: 1024) */
  maxTokenBudget?: number;
  /** TTL threshold in ms before a context item is deemed stale (default: 300,000ms / 5 minutes) */
  ttlMs?: number;
  /** Approximation factor: average characters per token (default: 4 chars/token) */
  charsPerToken?: number;
  /** Weight given to recency in composite score [0..1] (default: 0.4) */
  recencyWeight?: number;
  /** Weight given to relevance in composite score [0..1] (default: 0.6) */
  relevanceWeight?: number;
}

export interface BoundedContextBuildOptions {
  query?: string;
  referenceTimestamp?: number;
  overrideMaxTokens?: number;
}

export interface ScoredContextItem {
  item: ContextItem;
  relevanceScore: number;
  recencyScore: number;
  compositeScore: number;
  estimatedTokens: number;
  ageMs: number;
  isStale: boolean;
}

export interface BoundedContextResult {
  /** Selected context items packed within token budget */
  selectedItems: ContextItem[];
  /** Detailed scoring and token info for all evaluated items */
  evaluatedItems: ScoredContextItem[];
  /** Total approximate tokens utilized by selected items */
  totalTokensApprox: number;
  /** Maximum token budget configured */
  budgetLimit: number;
  /** Count of candidate items provided */
  totalCandidates: number;
  /** Count of items filtered out due to staleness (age > TTL) */
  staleFilteredCount: number;
  /** Count of non-stale items omitted due to token budget overflow */
  budgetOmittedCount: number;
  /** Final count of selected items */
  selectedCount: number;
}

/**
 * BoundedContextBuilder (Week 2 - Days 10–11)
 * 
 * Enforces:
 * 1. Bounded token budget with heuristic token approximation (~4 chars/token).
 * 2. Stale filtering: Automatic eviction of context items older than TTL threshold.
 * 3. Relevance & Recency selection: Ranks items by semantic overlap and freshness.
 * 4. Deterministic greedy packing: Guarantees prompt will never exceed token limit.
 */
export class BoundedContextBuilder {
  private config: Required<BoundedContextConfig>;

  constructor(config?: BoundedContextConfig) {
    this.config = {
      maxTokenBudget: config?.maxTokenBudget ?? 1024,
      ttlMs: config?.ttlMs ?? 300_000, // 5 minutes
      charsPerToken: config?.charsPerToken ?? 4,
      recencyWeight: config?.recencyWeight ?? 0.4,
      relevanceWeight: config?.relevanceWeight ?? 0.6
    };
  }

  /**
   * Approximates token count based on string length.
   * Standard heuristic: ~4 characters per token in English / code.
   */
  public approximateTokens(text: string): number {
    if (!text || text.length === 0) return 0;
    return Math.ceil(text.length / this.config.charsPerToken);
  }

  /**
   * Approximates tokens for a ContextItem including its metadata, source and content.
   */
  public approximateItemTokens(item: ContextItem): number {
    const rawContent = item.content || '';
    const metadataStr = JSON.stringify(item.metadata || {});
    const sourceStr = `${item.source?.application || ''} ${item.source?.windowTitle || ''} ${item.source?.filePath || ''}`;
    const totalChars = rawContent.length + metadataStr.length + sourceStr.length + 32; // base envelope overhead
    return Math.ceil(totalChars / this.config.charsPerToken);
  }

  /**
   * Extracts timestamp in milliseconds from a ContextItem's source.capturedAt.
   */
  public getItemTimestampMs(item: ContextItem): number {
    const capturedAt = item.source?.capturedAt;
    if (!capturedAt) return Date.now();
    if (typeof capturedAt === 'number') return capturedAt;
    if (capturedAt instanceof Date) return capturedAt.getTime();
    const parsed = Date.parse(capturedAt);
    return isNaN(parsed) ? Date.now() : parsed;
  }

  /**
   * Checks whether a context item exceeds the staleness TTL threshold.
   */
  public isStale(item: ContextItem, referenceTimestamp: number = Date.now()): boolean {
    const itemTime = this.getItemTimestampMs(item);
    const ageMs = referenceTimestamp - itemTime;
    return ageMs > this.config.ttlMs;
  }

  /**
   * Calculates recency score [0..1] based on exponential or linear decay over TTL window.
   */
  public calculateRecency(item: ContextItem, referenceTimestamp: number = Date.now()): number {
    const itemTime = this.getItemTimestampMs(item);
    const ageMs = Math.max(0, referenceTimestamp - itemTime);
    if (ageMs >= this.config.ttlMs) return 0.0;
    // Linear decay from 1.0 down to 0.0 at ttlMs
    return Math.max(0, 1 - (ageMs / this.config.ttlMs));
  }

  /**
   * Calculates relevance score [0..1] based on keyword overlap between query and item.
   */
  public calculateRelevance(item: ContextItem, query: string): number {
    if (!query || query.trim().length === 0) {
      // Default neutral relevance when no query is supplied
      return 0.5;
    }

    const queryTerms = query.toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter(t => t.length > 2);

    if (queryTerms.length === 0) return 0.5;

    const searchableCorpus = [
      item.content,
      item.type,
      item.source?.application,
      item.source?.windowTitle,
      item.source?.filePath,
      JSON.stringify(item.metadata || {})
    ].join(' ').toLowerCase();

    let matchedTerms = 0;
    for (const term of queryTerms) {
      if (searchableCorpus.includes(term)) {
        matchedTerms++;
      }
    }

    const coverage = matchedTerms / queryTerms.length;

    // Bonus for exact multi-word substring match
    const exactMatchBonus = searchableCorpus.includes(query.toLowerCase().trim()) ? 0.2 : 0;

    return Math.min(1.0, coverage + exactMatchBonus);
  }

  /**
   * Computes the combined score using configured weights.
   */
  public scoreItem(item: ContextItem, query: string, referenceTimestamp: number = Date.now()): ScoredContextItem {
    const itemTime = this.getItemTimestampMs(item);
    const ageMs = Math.max(0, referenceTimestamp - itemTime);
    const isStale = ageMs > this.config.ttlMs;
    const estimatedTokens = this.approximateItemTokens(item);

    const relevanceScore = this.calculateRelevance(item, query);
    const recencyScore = this.calculateRecency(item, referenceTimestamp);

    // If item is stale, composite score drops to 0
    const compositeScore = isStale 
      ? 0.0 
      : (this.config.relevanceWeight * relevanceScore) + (this.config.recencyWeight * recencyScore);

    return {
      item,
      relevanceScore,
      recencyScore,
      compositeScore,
      estimatedTokens,
      ageMs,
      isStale
    };
  }

  /**
   * Builds bounded context by:
   * 1. Filtering out stale items (age > ttlMs).
   * 2. Scoring remaining items on relevance + recency.
   * 3. Sorting in descending order of composite score.
   * 4. Greedy packing within maxTokenBudget without overflow.
   */
  public buildBoundedContext(
    items: ContextItem[], 
    options?: BoundedContextBuildOptions
  ): BoundedContextResult {
    const refTime = options?.referenceTimestamp ?? Date.now();
    const query = options?.query ?? '';
    const budget = options?.overrideMaxTokens ?? this.config.maxTokenBudget;

    // 1. Evaluate and score all candidate items
    const evaluated: ScoredContextItem[] = items.map(it => this.scoreItem(it, query, refTime));

    // 2. Partition into fresh vs stale
    const freshItems: ScoredContextItem[] = [];
    let staleFilteredCount = 0;

    for (const scored of evaluated) {
      if (scored.isStale) {
        staleFilteredCount++;
      } else {
        freshItems.push(scored);
      }
    }

    // 3. Sort fresh items descending by composite score
    freshItems.sort((a, b) => b.compositeScore - a.compositeScore);

    // 4. Greedy packing within token budget
    const selectedItems: ContextItem[] = [];
    let accumulatedTokens = 0;
    let budgetOmittedCount = 0;

    for (const scored of freshItems) {
      if (accumulatedTokens + scored.estimatedTokens <= budget) {
        selectedItems.push(scored.item);
        accumulatedTokens += scored.estimatedTokens;
      } else {
        budgetOmittedCount++;
      }
    }

    return {
      selectedItems,
      evaluatedItems: evaluated,
      totalTokensApprox: accumulatedTokens,
      budgetLimit: budget,
      totalCandidates: items.length,
      staleFilteredCount,
      budgetOmittedCount,
      selectedCount: selectedItems.length
    };
  }

  public getConfig(): Required<BoundedContextConfig> {
    return { ...this.config };
  }
}
