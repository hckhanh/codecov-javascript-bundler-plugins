import * as GitHub from "@actions/github";
import { jsonSchema } from "../../schemas.ts";
import {
  type ProviderEnvs,
  type ProviderServiceParams,
  type ProviderUtilInputs,
} from "../../types.ts";
import { type Output } from "../Output.ts";
import { debug } from "../logging.ts";
import { type PullRequestEvent } from "@octokit/webhooks-definitions/schema";

export function detect(envs: ProviderEnvs): boolean {
  return Boolean(envs?.GITHUB_ACTIONS);
}

function _getBuild(inputs: ProviderUtilInputs): ProviderServiceParams["build"] {
  const { args, envs } = inputs;
  if (args?.build && args.build !== "") {
    return args.build;
  }
  return envs?.GITHUB_RUN_ID ?? null;
}

async function _getJobURL(inputs: ProviderUtilInputs): Promise<string | null> {
  const url = `https://api.github.com/repos/${_getSlug(
    inputs,
  )}/actions/runs/${_getBuild(inputs)}/jobs`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Awesome-Octocat-App",
    },
  });

  if (res.status !== 200) {
    return null;
  }

  const rawJson = await res.json();
  const data = jsonSchema.parse(rawJson);
  const { envs } = inputs;

  if (
    data &&
    typeof data === "object" &&
    "jobs" in data &&
    Array.isArray(data?.jobs)
  ) {
    for (const job of data?.jobs) {
      if (
        job &&
        typeof job === "object" &&
        "name" in job &&
        job?.name == envs?.GITHUB_JOB &&
        "html_url" in job &&
        typeof job?.html_url === "string"
      ) {
        return job?.html_url;
      }
    }
  }

  return null;
}

async function _getBuildURL(
  inputs: ProviderUtilInputs,
): Promise<ProviderServiceParams["buildURL"]> {
  const { envs } = inputs;

  const url = await _getJobURL(inputs);
  if (url !== null) {
    return url;
  }

  return `${envs?.GITHUB_SERVER_URL}/${_getSlug(
    inputs,
  )}/actions/runs/${_getBuild(inputs)}`;
}

function _getBranch(
  inputs: ProviderUtilInputs,
): ProviderServiceParams["branch"] {
  const { args, envs } = inputs;
  if (args?.branch && args.branch !== "") {
    return args.branch;
  }

  const branchRegex = /refs\/heads\/(.*)/;
  const branchMatches = branchRegex.exec(envs?.GITHUB_REF ?? "");
  let branch;
  if (branchMatches) {
    branch = branchMatches[1];
  }

  if (envs?.GITHUB_HEAD_REF && envs?.GITHUB_HEAD_REF !== "") {
    branch = envs?.GITHUB_HEAD_REF;
  }

  // Following along as how we grab the forked branch name in our action
  // See: https://github.com/codecov/codecov-action/blob/main/src/buildExec.ts#L50
  // And it's usage in the CLI: https://github.com/codecov/codecov-cli/blob/main/codecov_cli/services/commit/__init__.py#L48-L52
  const context = GitHub.context;
  if (["pull_request", "pull_request_target"].includes(context.eventName)) {
    const payload = context.payload as PullRequestEvent;
    const baseLabel = payload.pull_request.base.label;
    const headLabel = payload.pull_request.head.label;
    const isFork = baseLabel.split(":")?.[0] !== headLabel.split(":")?.[0];

    // overriding the value if it is a fork, if not revert to the original branch value
    branch = isFork ? payload.pull_request.head.label : branch;
  }

  return branch ?? null;
}

function _getJob(envs: ProviderEnvs): ProviderServiceParams["job"] {
  return envs?.GITHUB_WORKFLOW ?? null;
}

function _getPR(inputs: ProviderUtilInputs): ProviderServiceParams["pr"] {
  const { args, envs } = inputs;
  if (args?.pr && args.pr !== "") {
    return args.pr;
  }

  let match;
  if (envs?.GITHUB_HEAD_REF && envs?.GITHUB_HEAD_REF !== "") {
    const prRegex = /refs\/pull\/([0-9]+)\/merge/;
    const matches = prRegex.exec(envs?.GITHUB_REF ?? "");
    if (matches) {
      match = matches[1];
    }
  }
  return match ?? null;
}

function _getService(): ProviderServiceParams["service"] {
  return "github-actions";
}

export function getServiceName(): string {
  return "GitHub Actions";
}

function _getSHA(
  inputs: ProviderUtilInputs,
  output: Output,
): ProviderServiceParams["commit"] {
  const { args, envs } = inputs;
  if (args?.sha && args.sha !== "") {
    debug(`Using commit: ${args.sha}`, { enabled: output.debug });
    return args.sha;
  }

  const context = GitHub.context;

  let commit = envs?.GITHUB_SHA;
  if (["pull_request", " pull_request_target"].includes(context.eventName)) {
    const payload = context.payload as PullRequestEvent;
    commit = payload.pull_request.head.sha;
  }

  debug(`Using commit: ${commit ?? null}`, { enabled: output.debug });

  return commit ?? null;
}

function _getCompareSHA(
  inputs: ProviderUtilInputs,
  output: Output,
): ProviderServiceParams["compareSha"] {
  const { args } = inputs;
  if (args?.compareSha && args.compareSha !== "") {
    debug(`Using commit: ${args.compareSha}`, { enabled: output.debug });
    return args.compareSha;
  }

  let compareSha = null;
  const context = GitHub.context;
  if (["pull_request", " pull_request_target"].includes(context.eventName)) {
    const payload = context.payload as PullRequestEvent;
    compareSha = payload.pull_request.base.sha;
  }

  debug(`Using compareSha: ${compareSha ?? null}`, { enabled: output.debug });

  return compareSha ?? null;
}

function _getSlug(inputs: ProviderUtilInputs): ProviderServiceParams["slug"] {
  const { args, envs } = inputs;
  if (args?.slug && args.slug !== "") {
    return args.slug;
  }
  return envs?.GITHUB_REPOSITORY ?? null;
}

export async function getServiceParams(
  inputs: ProviderUtilInputs,
  output: Output,
): Promise<ProviderServiceParams> {
  return {
    branch: _getBranch(inputs),
    build: _getBuild(inputs),
    buildURL: await _getBuildURL(inputs),
    commit: _getSHA(inputs, output),
    compareSha: _getCompareSHA(inputs, output),
    job: _getJob(inputs.envs),
    pr: _getPR(inputs),
    service: _getService(),
    slug: _getSlug(inputs),
  };
}

export function getEnvVarNames() {
  return [
    "GITHUB_ACTIONS",
    "GITHUB_JOB",
    "GITHUB_HEAD_REF",
    "GITHUB_REF",
    "GITHUB_REPOSITORY",
    "GITHUB_RUN_ID",
    "GITHUB_SERVER_URL",
    "GITHUB_SHA",
    "GITHUB_WORKFLOW",
  ];
}
