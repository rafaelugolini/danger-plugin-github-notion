import { message, danger } from "danger";

const modifiedMD = danger.git.modified_files.join("- ");
message("Changed Files in this PR: \n - " + modifiedMD);

function messagePR() {
  const title = danger.github.pr.title;
  const body = danger.github.pr.body;
  message(`PR Title: ${title}`);
  message(`PR Body: ${body}`);
}

messagePR();
