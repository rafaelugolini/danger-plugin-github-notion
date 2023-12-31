# danger-plugin-github-notion

[![npm version](https://badge.fury.io/js/danger-plugin-github-notion.svg)](https://badge.fury.io/js/danger-plugin-github-notion)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

> This plugin connects github PRs into Notion Projects

## Usage

Install:

```sh
yarn add danger-plugin-github-notion --dev
```

At a glance:

```js
// dangerfile.js
import dangerGithubNotion from 'danger-plugin-github-notion';

dangerGithubNotion({
    dbTasksId: 'UUID',
    // we require a task prefix to make it easier to detect the task
    // and avoid false positives
    taskPrefix: 'TAS',
    // optional
    teams: [
        {
            org: 'OrgName',
            team_slug: 'TeamName',
        },
    ],
});
```

## Changelog

See the GitHub [release history](https://github.com/rafaelugolini/danger-plugin-github-notion/releases).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
