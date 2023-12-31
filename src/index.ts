import { Client } from '@notionhq/client';
import { GetPageResponse } from '@notionhq/client/build/src/api-endpoints';
import { GitHubPRDSL } from 'danger';
import { DangerDSLType } from 'danger/distribution/dsl/DangerDSL';
import { Octokit } from 'octokit';

// danger type declaration
declare var danger: DangerDSLType;
export declare function message(message: string): void;
export declare function warn(message: string): void;
export declare function fail(message: string): void;
export declare function markdown(message: string): void;

interface ConfigTeam {
    org: string;
    team_slug: string;
}

interface Config {
    // dbProjectsId: string;
    dbTasksId: string;
    taskPrefix: string;
    teams?: ConfigTeam[];
}

const NOTION_API_TOKEN = process.env.NOTION_API_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Initializing a client
const notion = new Client({
    auth: NOTION_API_TOKEN,
});
const octokit = new Octokit({
    auth: GITHUB_TOKEN,
});

const REGEX_URL =
    /(http|https)\:\/\/([a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,3})(\/\S*)?/gim;
const REGEX_NOTION_ID_PARENT_VIEW = /.+p\=(\S{32})\?{0,1}.*/i;
const REGEX_NOTION_ID = /.+\-(\S{32})\?{0,1}.*/i;

async function validatePR(pr: GitHubPRDSL, config: Config) {
    if (!config.teams) {
        return true;
    }
    const isActive = config.teams.map(async (team) => {
        const res = await octokit.rest.teams.getMembershipForUserInOrg({
            org: team.org,
            team_slug: team.team_slug,
            username: pr.user.login,
        });
        return res.data.state === 'active';
    });
    const active = await Promise.all(isActive);
    return active.some((a) => a === true);
}

function getTaskByPR(pr: GitHubPRDSL, taskPrefix: string): string | undefined {
    const regexTaskId = new RegExp(`${taskPrefix}\\-\\d+`, 'gm');

    const taskId = pr.title.match(regexTaskId);

    // @ts-ignore-next-line: typescript is complaining about something it shouldn't
    if (taskId?.length > 1) {
        fail('❌ More than one task ID found in PR title');
        process.exit(1);
    }

    if (taskId?.length === 1) {
        return taskId[0];
    }
}

function transformNotionId(notionId: string): string {
    return (
        notionId.slice(0, 8) +
        '-' +
        notionId.slice(8, 12) +
        '-' +
        notionId.slice(12, 16) +
        '-' +
        notionId.slice(16, 20) +
        '-' +
        notionId.slice(20, 32)
    );
}

async function getNotionId(body: string): Promise<string> {
    const matchesUrl = body.match(REGEX_URL);
    const notionIds: string[] = [];

    if (matchesUrl) {
        for (const matchUrl of matchesUrl) {
            if (matchUrl.includes('notion.so')) {
                const matchNotionId = matchUrl.match(REGEX_NOTION_ID);
                const matchNotionIdParentView = matchUrl.match(
                    REGEX_NOTION_ID_PARENT_VIEW,
                );
                if (matchNotionId) {
                    notionIds.push(transformNotionId(matchNotionId[1]));
                } else if (matchNotionIdParentView) {
                    notionIds.push(
                        transformNotionId(matchNotionIdParentView[1]),
                    );
                }
            }
        }
    }
    if (notionIds.length === 0) {
        fail(
            '❌ No Notion link found in PR body. Please add one of the following methods to link the PR to a Notion task:<br />' +
                '- Add a Notion Project link in the PR body<br />' +
                '- Add a Notion Task link in the PR body<br />' +
                '- Add a Notion Task ID in the PR title',
        );
        process.exit(1);
    } else if (notionIds.length > 1) {
        fail('More than one Notion link found in PR body');
        process.exit(1);
    }

    return notionIds[0];
}

async function createTask(
    pr: GitHubPRDSL,
    dbTasksId: string,
    projectId: string,
    parentTaskId: string | undefined = undefined,
) {
    const task = {
        parent: {
            type: 'database_id',
            database_id: dbTasksId,
        },
        icon: {
            type: 'external',
            external: {
                url: 'https://blog.crisp.se/wp-content/uploads/2023/05/pull-request.png',
            },
        },
        properties: {
            'Task name': {
                title: [
                    {
                        text: {
                            content: pr.title,
                        },
                    },
                ],
            },
            Status: {
                status: {
                    id: 'in-progress',
                },
            },
            Summary: {
                rich_text: [
                    {
                        text: {
                            content: pr.body, // maybe strip the notion link?
                        },
                    },
                ],
            },
            Project: {
                relation: [
                    {
                        id: projectId,
                    },
                ],
            },
        },
    };
    if (parentTaskId) {
        task.properties['Parent-task'] = {
            relation: [{ id: parentTaskId }],
        };
    }
    //   @ts-ignore-next-line: typescript is complaining about something it shouldn't
    let res = await notion.pages.create(task);
    // [Task ID] comes null from the API, so we need to retrieve the page again
    res = await notion.pages.retrieve({ page_id: res['id'] });
    const { unique_id } = res['properties']['Task ID'];

    // update the page with the task id
    const taskId = `${unique_id.prefix}-${unique_id.number}`;
    await notion.pages.update({
        page_id: res['id'],
        properties: {
            'Task name': {
                title: [
                    {
                        text: {
                            content: `[${taskId}] ${pr.title}`,
                        },
                    },
                ],
            },
        },
    });

    return `${unique_id.prefix}-${unique_id.number}`;
}

async function updatePrTitle(pr: GitHubPRDSL, title: string) {
    await octokit.rest.pulls.update({
        owner: pr.base.repo.owner.login,
        repo: pr.base.repo.name,
        pull_number: pr.number,
        title,
    });
}

export default async function plugin(config: Config) {
    const title = danger.github.pr.title;
    const body = danger.github.pr.body;

    // team member
    const validate = await validatePR(danger.github.pr, config);
    if (!validate) {
        message('❌ Not applying rules to this PR(Not a team member)');
        process.exit(0);
    }

    let taskId = getTaskByPR(danger.github.pr, config.taskPrefix);
    // task id is already in the title
    if (taskId) {
        message(`✅ task id: ${taskId}`);
        return;
    }

    // get uuid from notion link
    const notionId = await getNotionId(body);

    // get the page from uuid
    let page: GetPageResponse;
    try {
        page = await notion.pages.retrieve({ page_id: notionId });
    } catch (error) {
        fail('❌ Notion link is not valid');
        process.exit(1);
    }

    // add parent task id if database is from tasks
    let parentTaskId: string | undefined = undefined;
    if (page['parent'].database_id == config.dbTasksId) {
        parentTaskId = notionId;
    }
    taskId = await createTask(
        danger.github.pr,
        config.dbTasksId,
        notionId,
        parentTaskId,
    );
    const titleWithTaskId = `[${taskId}] ${title}`;
    await updatePrTitle(danger.github.pr, titleWithTaskId);
    message(`✅ task id: ${taskId}`);
}
