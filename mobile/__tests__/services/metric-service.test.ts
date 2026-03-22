import { metricService, MetricsResponse } from '../../services/metric-service';

// Mock the fetch function
global.fetch = jest.fn();

// Mock the auth module
jest.mock('../../utils/auth', () => ({
  getAuthToken: jest.fn().mockResolvedValue('test-token'),
}));

describe('MetricService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getMockMetrics', () => {
    it('returns mock metrics with correct structure', async () => {
      const metrics = await metricService.getMockMetrics();

      expect(metrics).toHaveProperty('metrics');
      expect(metrics).toHaveProperty('profile');

      // Check metrics structure
      expect(metrics.metrics).toHaveProperty('catchup');
      expect(metrics.metrics).toHaveProperty('divein');
      expect(metrics.metrics).toHaveProperty('recap');
      expect(metrics.metrics).toHaveProperty('lastUpdated');

      // Check catchup metrics
      expect(metrics.metrics.catchup).toHaveProperty('dailyProgress');
      expect(metrics.metrics.catchup).toHaveProperty('dailyGoal');
      expect(metrics.metrics.catchup).toHaveProperty('weeklyTotal');

      // Check divein metrics
      expect(metrics.metrics.divein).toHaveProperty('weeklyProgress');
      expect(metrics.metrics.divein).toHaveProperty('weeklyGoal');

      // Check recap metrics
      expect(metrics.metrics.recap).toHaveProperty('status');
      expect(metrics.metrics.recap).toHaveProperty('weeklyProgress');
      expect(metrics.metrics.recap).toHaveProperty('weeklyGoal');

      // Check profile
      expect(metrics.profile).toHaveProperty('coreIndustry');
      expect(metrics.profile).toHaveProperty('specializations');
      expect(metrics.profile).toHaveProperty('additionalInterests');
    });

    it('returns valid recap status values', async () => {
      // Call multiple times to check randomness
      for (let i = 0; i < 10; i++) {
        const metrics = await metricService.getMockMetrics();
        expect(['not_started', 'in_progress', 'completed']).toContain(
          metrics.metrics.recap.status
        );
      }
    });

    it('returns valid numeric values', async () => {
      const metrics = await metricService.getMockMetrics();

      expect(metrics.metrics.catchup.dailyProgress).toBeGreaterThanOrEqual(0);
      expect(metrics.metrics.catchup.dailyGoal).toBeGreaterThan(0);
      expect(metrics.metrics.divein.weeklyProgress).toBeGreaterThanOrEqual(0);
      expect(metrics.metrics.divein.weeklyGoal).toBeGreaterThan(0);
    });
  });

  describe('getMetricsWithFallback', () => {
    it('returns mock metrics when API fails', async () => {
      // Make API call fail
      (fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const metrics = await metricService.getMetricsWithFallback();

      // Should still return valid metrics (from mock)
      expect(metrics).toHaveProperty('metrics');
      expect(metrics).toHaveProperty('profile');
    });

    it('returns API metrics when available', async () => {
      const mockApiResponse: MetricsResponse = {
        metrics: {
          catchup: { dailyProgress: 15, dailyGoal: 30, weeklyTotal: 100 },
          divein: { weeklyProgress: 60, weeklyGoal: 120 },
          recap: { status: 'completed', weeklyProgress: 60, weeklyGoal: 60 },
          lastUpdated: new Date().toISOString(),
        },
        profile: {
          coreIndustry: 'Technology',
          specializations: ['AI & ML'],
          additionalInterests: ['Healthcare'],
        },
      };

      // Mock successful API calls
      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            today: { catchup_minutes: 15 },
            week: [{ catchup_minutes: 100, divein_minutes: 60, recap_completed: true }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            core_industry: 'Technology',
            specializations: ['AI & ML'],
            additional_interest_industries: ['Healthcare'],
            catchup_daily_goal_minutes: 30,
            divein_weekly_goal_minutes: 120,
            recap_weekly_goal_minutes: 60,
          }),
        });

      const metrics = await metricService.getMetricsWithFallback();

      expect(metrics).toHaveProperty('metrics');
      expect(metrics.profile.coreIndustry).toBe('Technology');
    });
  });
});
