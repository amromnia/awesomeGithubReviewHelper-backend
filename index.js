const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const prettier = require('prettier');
// const { diff_match_patch } = require('diff-match-patch');
// cors
const cors = require('cors');
require('dotenv').config();


const app = express();
app.use(cors());
app.use(express.json());

const PORT = 5000;

// Helper function to execute shell commands
const executeCommand = (command, cwd = '.') => {
  return new Promise((resolve, reject) => {
    exec(command, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(stderr || error.message);
      } else {
        resolve(stdout.trim());
      }
    });
  });
};

const findProperParser = (fileName) => {
  const ext = fileName.split('.').pop();
  if (ext == 'json') return 'json';
  if (ext == 'html') return 'html';
  if (ext == 'css') return 'css';
  if (ext == 'scss' || ext == 'sass') return 'scss';
  if (ext == 'less') return 'less';
  if (ext == 'md') return 'markdown';
  if (ext == 'yaml' || ext == 'yml') return 'yaml';
  if (ext == 'jsx' || ext == 'js' || ext == 'ts' || ext == 'tsx') return 'babel';
  return false; 
}


const formatOrReturnContent = async (content, fileName) => {
  try {
    const parser = findProperParser(fileName);
    console.log(parser);
    if(!parser) return content;
    return await prettier.format(content, { parser: parser });
  } catch (error) {
    return content;
  }
}

// Helper to clone or fetch a repository
const cloneOrFetchRepo = async (repoUrl, repoDir) => {
  if (!fs.existsSync(repoDir)) {
    // Clone the repository if it doesn't exist
    await executeCommand(`git clone ${repoUrl} ${repoDir}`);
  } else {
    // Fetch updates if the repo already exists
    await executeCommand(`git fetch`, repoDir);
  }
};

// Route to get all branches in a repository
app.get('/branches', async (req, res) => {
  const { repoUrl } = req.query;
  const repoDir = path.join(process.env.REPO_DIRECTORY, 'repos', repoUrl.split('/').pop().replace('.git', ''));

  try {
    await cloneOrFetchRepo(repoUrl, repoDir);
    const branches = await executeCommand('git branch -r', repoDir);

    const branchList = branches
      .split('\n')
      .map(branch => branch.trim().replace('origin/', ''))
      .filter(branch => branch !== 'HEAD'); // Exclude HEAD
    console.log(branchList)
    // res.send("Hello");
    return res.json({ branches: branchList });
  } catch (error) {
    console.log(error)
    res.status(500).json({ error: `Failed to fetch branches: ${error}` });
  }
});

// Route to get all open PRs in a repository
app.get('/prs', async (req, res) => {
  const { repoUrl } = req.query;
  const repoDir = path.join(process.env.REPO_DIRECTORY, 'repos', repoUrl.split('/').pop().replace('.git', ''));

  try {
    await cloneOrFetchRepo(repoUrl, repoDir);
    const prs = await executeCommand('gh pr list --json number,title', repoDir);
    const prList = JSON.parse(prs);

    res.json({ prs: prList });
  } catch (error) {
    console.log(error)
    res.status(500).json({ error: `Failed to fetch PRs: ${error}` });
  }
});

// Helper function to check if branch exists
const branchExists = async (branch, repoDir) => {
    try {
      const branches = await executeCommand('git branch -r', repoDir);
      return branches.includes(`origin/${branch}`);
    } catch (error) {
      return false;
    }
  };
  
  // Route to compare a branch and PR in a repository
  app.get('/compare', async (req, res) => {
    const { repoUrl, branch, pr } = req.query;
    const repoDir = path.join(process.env.REPO_DIRECTORY, 'repos', repoUrl.split('/').pop().replace('.git', ''));
  
    try {
      await cloneOrFetchRepo(repoUrl, repoDir);
      await executeCommand('git fetch --all', repoDir);
  
      // Check if the branch exists
      const branchExistsResult = await branchExists(branch, repoDir);
      if (!branchExistsResult) {
        return res.status(400).json({ error: `Branch '${branch}' does not exist` });
      }
  
      await executeCommand(`git reset --hard`, repoDir);
      await executeCommand(`git checkout -B ${branch} origin/${branch}`, repoDir);
  
      // Fetch the PR and create a local reference for it
      await executeCommand(`git fetch origin pull/${pr}/head:pr-${pr}`, repoDir);
  
      // Get the list of files changed in the PR
      const changedFiles = await executeCommand(`git diff --name-only pr-${pr}..${branch}`, repoDir);
      const fileList = changedFiles.trim().split('\n');
      console.log(fileList)
  
      const diffs = [];
  
      for (const file of fileList) {
        // Check out the branch and PR content for the file
        try {
          let branchContent, prContent;
    
          try {
            branchContent = await executeCommand(`git show ${branch}:"${file}"`, repoDir);
          } catch (error) {
            console.log(`Error getting branch content for file ${file}:`, error);
            // continue; // Skip this file if an error occurs
          } 

          try {
            prContent = await executeCommand(`git show pr-${pr}:"${file}"`, repoDir);
          } catch (error) {
            console.log(`Error getting PR content for file ${file}:`, error);
            // continue; // Skip this file if an error occurs
          }
    
          // Ensure both contents are strings before formatting
          if (branchContent && typeof branchContent !== 'string' || prContent && typeof prContent !== 'string') {
            console.log(`Invalid content for file ${file}:`, { branchContent, prContent });
            continue; // Skip this file if contents are not valid
          }
          
          const formattedBranchContent = branchContent ? await formatOrReturnContent(branchContent, file) : '';
          const formattedPrContent = prContent ? await formatOrReturnContent(prContent, file) : '';
      
          diffs.push({
            file,
            branchContent: formattedBranchContent,
            prContent: formattedPrContent,
            onlyFormattingChanges: formattedBranchContent === formattedPrContent,
          });
        } catch (error) {
          console.log(error); 
        }
      }
  
      res.json(diffs);
    } catch (error) {
      console.log(error);
      res.status(500).json({ error: `Failed to compare branch and PR: ${error}` });
    }
  });

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
