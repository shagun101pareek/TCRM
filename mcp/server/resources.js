'use strict';

const { exists, readText } = require('../../scripts/lib/common');

const RESOURCES = [
  {
    uri: 'telecrm://agent-context',
    name: 'Agent Context',
    mimeType: 'text/markdown',
    path: 'AGENT_CONTEXT.md',
  },
  {
    uri: 'telecrm://changelog',
    name: 'Agent Changelog',
    mimeType: 'text/markdown',
    path: 'AGENT_CHANGELOG.md',
  },
  {
    uri: 'telecrm://mcp-guide',
    name: 'MCP Guide',
    mimeType: 'text/markdown',
    path: 'MCP.md',
  },
  {
    uri: 'telecrm://scripts-readme',
    name: 'Scripts README',
    mimeType: 'text/markdown',
    path: 'scripts/README.md',
  },
  {
    uri: 'telecrm://do-not-modify',
    name: 'Do Not Modify',
    mimeType: 'text/markdown',
    text:
      `# Do not modify without approval\n\n` +
      `- \`new workflows/**\` (1- and 3- JSON are source of truth; do not edit \`main prod.json\` as a third copy)\n` +
      `- \`new-telecrm-webhook.js\`, \`new-telecrm-watcher.js\`, \`reconcile-telecrm-stage.js\`\n` +
      `- \`.env\`\n` +
      `- Do not write \`users.profileData.status\` from sync\n` +
      `- Do not enable \`NEW_TELECRM_PUSH_SOURCE\` or run \`reconcile --apply\` without approval\n` +
      `- Do not mix UTM with \`lead_source\`\n` +
      `- MongoDB MCP is read-only; findings go in \`mcp/findings/\` as new files only\n`,
  },
  {
    uri: 'telecrm://agent-workflow',
    name: 'Agent Workflow',
    mimeType: 'text/plain',
    text:
      `Understand context (AGENT_CONTEXT.md + get_do_not_modify)\n` +
      `     ↓\n` +
      `Inspect repository (get_repo_structure / inspect-repo)\n` +
      `     ↓\n` +
      `snapshot_task_start\n` +
      `     ↓\n` +
      `Inspect relevant files (read_project_file / architecture docs)\n` +
      `     ↓\n` +
      `Understand requested change\n` +
      `     ↓\n` +
      `Make minimal changes (never protected files without approval)\n` +
      `     ↓\n` +
      `Run validation (validate_repo / scripts/validate.js)\n` +
      `     ↓\n` +
      `Inspect changes (detect_changes / get_git_diff)\n` +
      `     ↓\n` +
      `Record changes (record_agent_change → AGENT_CHANGELOG.md)\n`,
  },
  {
    uri: 'telecrm://status-mapping',
    name: 'Status Mapping',
    mimeType: 'text/markdown',
    path: 'new workflows/STATUS-MAPPING.md',
  },
  {
    uri: 'telecrm://edge-cases',
    name: 'Edge Cases',
    mimeType: 'text/markdown',
    path: 'new workflows/EDGE-CASES.md',
  },
  {
    uri: 'telecrm://field-flow',
    name: 'Field Flow',
    mimeType: 'text/markdown',
    path: 'new workflows/FIELD-FLOW.md',
  },
  {
    uri: 'telecrm://cross-platform-actions',
    name: 'Cross-Platform Actions',
    mimeType: 'text/markdown',
    path: 'new workflows/CROSS-PLATFORM-ACTIONS.md',
  },
  {
    uri: 'telecrm://whole-flow',
    name: 'Mongo whole-flow finding',
    mimeType: 'text/markdown',
    path: 'mcp/findings/whole-flow.md',
  },
  {
    uri: 'telecrm://platforms',
    name: 'Platforms MCP map',
    mimeType: 'text/markdown',
    path: 'mcp/findings/platforms.md',
  },
];

const PROMPTS = [
  {
    name: 'telecrm_task',
    description: 'Standard TeleCRM agent workflow for a repository change.',
    arguments: [
      { name: 'task', description: 'What the human asked for', required: true },
    ],
  },
];

function listResources() {
  return RESOURCES.map(({ uri, name, mimeType }) => ({ uri, name, mimeType }));
}

function readResource(uri) {
  const rec = RESOURCES.find((r) => r.uri === uri);
  if (!rec) throw new Error(`Unknown resource: ${uri}`);
  let text = rec.text;
  if (rec.path) {
    if (!exists(rec.path)) throw new Error(`Missing file: ${rec.path}`);
    text = readText(rec.path);
  }
  return {
    contents: [
      {
        uri: rec.uri,
        mimeType: rec.mimeType,
        text,
      },
    ],
  };
}

function getPrompt(name, args = {}) {
  if (name !== 'telecrm_task') throw new Error(`Unknown prompt: ${name}`);
  const task = args.task || '(unspecified)';
  return {
    description: 'TeleCRM repository agent workflow',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `Task: ${task}\n\n` +
            `Follow this workflow:\n` +
            `1. Read AGENT_CONTEXT.md and the do-not-modify list.\n` +
            `2. Inspect only the relevant files.\n` +
            `3. Call snapshot_task_start before edits.\n` +
            `4. Make the smallest change that satisfies the task.\n` +
            `5. Do not edit new workflows/, root *.js, or .env unless the human explicitly approved it.\n` +
            `6. Run validate_repo.\n` +
            `7. Call detect_changes and record_agent_change.\n`,
        },
      },
    ],
  };
}

module.exports = { RESOURCES, PROMPTS, listResources, readResource, getPrompt };
