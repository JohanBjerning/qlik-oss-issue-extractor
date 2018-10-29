const fetch = require("node-fetch");
const mysql = require('mysql');
const Promise = require('bluebird');

const mysqlcon = mysql.createPool ({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USERNAME,
    password: process.env.MYSQL_PW,
    port: process.env.MYSQL_PORT,
    database: "issues"
  });

const getIssuesQuery = (cursor) => `query {
    search(type:ISSUE, first: 100, ${cursor}query: "is:issue org:qlik-oss") {
        issueCount
        pageInfo {
            endCursor
            hasNextPage
        }
      nodes {
        ... on Issue {
            labels(first: 10) {
            	nodes { name }
          	}
            bodyText
            id
            createdAt
            closedAt
            title
            url
            author {
              login
            }
            state
            repository {
                name
            }
        }
      }
  }
}`;

const body = (xQuery) =>
  JSON.stringify({
    query: xQuery
  });

function runQuery(body) {
  const url = "https://api.github.com/graphql";
  const options = {
    method: "POST",
    body: body,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `bearer ${process.env.GITHUB_TOKEN}`
    }
  };
  
  return fetch(url, options)
    .then(resp => resp.json())
    .then(data => {
      return data.data;
    });
}

function getIssues(cursor) {
  return runQuery(body(getIssuesQuery(cursor)));
}

exports.handler = async (event, context, callback) => {
    var issues = await getIssues("");
    var moreData = true;
    var values = new Array();
    var history = new Array();
    var bug = 0;
    
    let now = new Date().toISOString();
    let date = now.substring(0,10);

    context.callbackWaitsForEmptyEventLoop = false; 

    while(moreData) {
        issues.search.nodes.forEach(async (issue) => {
            bug = 0;
            if(issue.labels) {
                issue.labels.nodes.forEach(async (label) => {
                    if(label.name.includes("bug")) {
                        bug = 1;
                    }
                });
            }
            values.push([issue.id, issue.repository.name, issue.title, issue.url, issue.author.login, issue.bodyText, issue.createdAt, bug]);
            history.push([issue.id, issue.state, issue.closedAt, now, date]);
        });
        if(issues.search.pageInfo.hasNextPage) {
            issues = await getIssues("after: \"" + issues.search.pageInfo.endCursor + "\", ");
        }
        else {
            moreData = false;
        }
    }

    return new Promise((resolve, reject) => {
        mysqlcon.getConnection(function(err, connection) {
            if (err) {
                reject(err);
            }
            var sql = "INSERT IGNORE INTO githubissues (ID, repo, title, url, author, body, created, isBug) VALUES ?";
            connection.query(sql, [values], function (err, result1) {
                if (err) {
                    connection.release();
                    reject(err);
                }
                sql = "INSERT IGNORE INTO githubissues_history (ID, state, closed, datestamp, report_date) VALUES ?";
                connection.query(sql, [history], function (err, result2) {
                    if (err) {
                        connection.release();
                        reject(err);
                    }
                    connection.release();
                    resolve(result1 + result2);
                });
            });                
        });
    });
};


