// The demo workspace. Flags are plain JSON, which is how they would arrive
// from an API or a YAML file in a real deployment.

const DAY = 86_400_000;
const iso = (now, offsetDays) => new Date(now + offsetDays * DAY).toISOString();

export const SAMPLE_ATTRIBUTES = {
  userId: "user_4821",
  email: "nima@example.com",
  plan: "pro",
  country: "NP",
  device: "desktop",
  ltv: 640,
};

export function createSampleWorkspace({ now = Date.now() } = {}) {
  return {
    version: 3,
    flags: [
      {
        key: "new-checkout",
        name: "New checkout",
        description: "Rebuilt payment step with saved cards.",
        enabled: true,
        onValue: true,
        offValue: false,
        rollout: 15,
        rules: [
          {
            id: "staff-holdback",
            description: "Arvion staff keep the old flow while we watch error rates.",
            when: { attribute: "email", operator: "ends_with", value: "@arviontech.net" },
            value: false,
          },
          {
            id: "nepal-paid",
            description: "Nepal and a paid plan gets the new flow immediately.",
            when: {
              all: [
                { attribute: "country", operator: "eq", value: "NP" },
                { attribute: "plan", operator: "in", value: ["pro", "enterprise"] },
              ],
            },
            value: true,
          },
          {
            id: "paid-rollout",
            description: "Everyone else on a paid plan is bucketed at 35%.",
            when: { attribute: "plan", operator: "in", value: ["pro", "enterprise"] },
            percentage: 35,
            value: true,
          },
        ],
      },
      {
        key: "search-v2",
        name: "Search v2",
        description: "New ranking model behind a variant flag.",
        enabled: true,
        onValue: "v2",
        offValue: "control",
        rollout: 0,
        segments: {
          "beta-testers": {
            all: [
              { attribute: "plan", operator: "eq", value: "enterprise" },
              { attribute: "country", operator: "in", value: ["NP", "IN"] },
            ],
          },
        },
        rules: [
          {
            id: "mobile-nepal",
            description: "Mobile traffic from Nepal goes first.",
            when: {
              all: [
                { attribute: "device", operator: "eq", value: "mobile" },
                { attribute: "country", operator: "eq", value: "NP" },
              ],
            },
            value: "v2",
          },
          {
            id: "beta-testers",
            description: "Segment membership also unlocks v2.",
            when: { segment: "beta-testers" },
            value: "v2",
          },
        ],
      },
      {
        key: "weekly-digest",
        name: "Weekly digest email",
        description: "Scheduled campaign: on for the next two weeks.",
        enabled: true,
        onValue: true,
        offValue: false,
        rollout: 100,
        rules: [],
        schedule: { start: iso(now, -2), end: iso(now, 12) },
      },
      {
        key: "legacy-banner",
        name: "Legacy upgrade banner",
        description: "Killed after the migration; kept as a switch.",
        enabled: false,
        onValue: true,
        offValue: false,
        rollout: 100,
        rules: [],
      },
    ],
  };
}

export const FLAG_HASHES = {
  "new-checkout": "default",
  "search-v2": "mobile",
  "weekly-digest": "scheduled",
  "legacy-banner": "disabled",
};
