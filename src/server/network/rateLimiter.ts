/*
	rateLimiter.ts  (server)

	Token bucket per remote, per player. A client can fire a RemoteEvent in a
	tight loop; without this that is a free way to burn server CPU, and for
	anything random it is a way to re-roll until the result is good.
*/

interface Bucket {
	tokens: number;
	burst: number;
	refill: number;
	updatedAt: number;
}

export class RateLimiter {
	private readonly buckets = new Map<string, Bucket>();

	// Returns false when the bucket is empty; the caller rejects the request.
	public Consume(key: string, burst: number, refill: number): boolean {
		// os.clock is monotonic per server, so a clock change cannot skew it.
		const now = os.clock();

		let bucket = this.buckets.get(key);
		if (!bucket) {
			bucket = { tokens: burst, burst, refill, updatedAt: now };
			this.buckets.set(key, bucket);
		}

		const elapsed = math.max(0, now - bucket.updatedAt);
		bucket.updatedAt = now;
		bucket.tokens = math.min(bucket.burst, bucket.tokens + elapsed * bucket.refill);

		if (bucket.tokens < 1) return false;
		bucket.tokens -= 1;
		return true;
	}
}
