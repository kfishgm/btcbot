#!/usr/bin/env node
/**
 * GitHub Issues-based Task Scheduler
 * Uses GitHub Issues as the single source of truth for task management
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class GitHubTaskScheduler {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.repo = this.getRepoInfo();
  }

  /**
   * Get repository info from git remote
   */
  getRepoInfo() {
    try {
      const remote = execSync('git remote get-url origin', { 
        cwd: this.projectRoot, 
        encoding: 'utf8' 
      }).trim();
      
      // Extract owner/repo from git@github.com:owner/repo.git or https://github.com/owner/repo.git
      const match = remote.match(/github\.com[:/]([^/]+)\/([^.]+)/);
      if (!match) throw new Error('Could not parse GitHub remote');
      
      return {
        owner: match[1],
        repo: match[2].replace('.git', '')
      };
    } catch (error) {
      console.error('Error getting repo info:', error);
      return null;
    }
  }

  /**
   * Execute GitHub CLI command
   */
  gh(command) {
    try {
      return execSync(`gh ${command}`, {
        cwd: this.projectRoot,
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1' }
      }).trim();
    } catch (error) {
      console.error(`GitHub CLI error: ${error.message}`);
      return null;
    }
  }

  /**
   * Get all open task issues
   */
  getAllTasks() {
    const tasks = this.gh('issue list --state open --label "task" --limit 200 --json number,title,body,labels,assignees,state');
    return tasks ? JSON.parse(tasks) : [];
  }

  /**
   * Get all tasks (both open and closed) for dependency checking
   */
  getAllTasksWithState() {
    const tasks = this.gh('issue list --label "task" --state all --limit 200 --json number,title,body,state,labels,assignees');
    return tasks ? JSON.parse(tasks) : [];
  }

  /**
   * Get next available task for an agent
   */
  getNextTask(agentRole) {
    const tasks = this.getAllTasks();
    const allTasksWithState = this.getAllTasksWithState();
    
    
    // Create a map of task number to task data for dependency checking
    const taskDataMap = new Map();
    allTasksWithState.forEach(task => {
      taskDataMap.set(task.number, task);
    });
    
    // Map agent roles to their order in the pipeline
    const agentOrder = {
      'architect': 0,
      'test': 1,
      'implementation': 2
    };
    
    const roleIndex = agentOrder[agentRole];
    if (roleIndex === undefined) {
      console.error(`Unknown agent role: ${agentRole}`);
      return null;
    }

    // No longer using priority levels - backlog position is the only priority

    // Find tasks that need this agent's work
    const eligibleTasks = tasks
      .filter(task => task.state === 'OPEN')
      .filter(task => {
        // Double-check the task is still open (in case of race conditions)
        const currentTask = taskDataMap.get(task.number);
        if (currentTask && currentTask.state !== 'OPEN') {
          console.error(`Warning: Task #${task.number} is ${currentTask.state} but was in open list`);
          return false;
        }
        
        // Skip if already assigned to someone
        if (task.assignees && task.assignees.length > 0) {
          return false;
        }

        // Check dependencies for this specific agent
        const dependencies = this.parseDependencies(task.body);
        for (const depNum of dependencies) {
          const depTask = taskDataMap.get(depNum);
          if (!depTask) continue; // Dependency not found, skip
          
          // For per-agent checking:
          // - If dependency is closed, it's satisfied
          // - If dependency is open, check if this agent has completed their part
          if (depTask.state === 'OPEN') {
            const agentCompleted = this.isAgentWorkComplete(depTask, agentRole);
            if (!agentCompleted) {
              // This agent hasn't completed their work on the dependency
              return false;
            }
          }
          // If dependency is closed or agent has completed their part, continue
        }

        // Get completion status from labels
        const completionStatus = this.parseLabels(task.labels || []);
        
        // Agents work in sequence with dependencies
        if (roleIndex === 0) {
          // Architect can take any uncompleted task (no dependencies)
          const eligible = !completionStatus.architect;
          return eligible;
        } else if (roleIndex === 1) {
          // Test needs architect to be done
          return completionStatus.architect && !completionStatus.test;
        } else if (roleIndex === 2) {
          // Implementation needs BOTH architect AND test to be done
          return completionStatus.architect && completionStatus.test && !completionStatus.implementation;
        }
        return false;
      })
      .sort((a, b) => {
        // Sort ONLY by backlog position
        const aBacklogPos = this.parseBacklogPosition(a);
        const bBacklogPos = this.parseBacklogPosition(b);
        
        return aBacklogPos - bBacklogPos;
      });

    return eligibleTasks.length > 0 ? eligibleTasks[0] : null;
  }

  /**
   * Parse priority from issue body or labels
   */
  parsePriority(task) {
    // Check labels first
    if (task.labels && task.labels.length > 0) {
      for (const label of task.labels) {
        if (label.name && label.name.startsWith('priority:')) {
          return label.name.replace('priority:', '').toUpperCase();
        }
      }
    }
    
    // Check body for priority metadata
    const body = task.body || '';
    const priorityMatch = body.match(/Priority:\s*(P[0-3])/i);
    if (priorityMatch) {
      return priorityMatch[1].toUpperCase();
    }
    
    // Default priority
    return 'P2';
  }

  /**
   * Parse backlog position from issue body (handles both **Backlog Position**: and plain format)
   */
  parseBacklogPosition(task) {
    const body = task.body || '';
    
    // Try markdown format first
    let positionMatch = body.match(/\*\*Backlog Position\*\*:\s*(\d+)/i);
    if (positionMatch) {
      return parseInt(positionMatch[1]);
    }
    
    // Fall back to plain format
    positionMatch = body.match(/Backlog Position:\s*(\d+)/i);
    if (positionMatch) {
      return parseInt(positionMatch[1]);
    }
    
    // Default to a high number to put at end
    return 9999;
  }

  /**
   * Parse completion status from labels
   * Looks for -done labels for each agent
   */
  parseLabels(labels = []) {
    const status = {
      architect: false,
      test: false,
      implementation: false
    };

    // Check labels for completion status
    labels.forEach(label => {
      const labelName = typeof label === 'string' ? label : label.name;
      if (labelName === 'architect-done') {
        status.architect = true;
      } else if (labelName === 'test-done') {
        status.test = true;
      } else if (labelName === 'implementation-done') {
        status.implementation = true;
      }
    });

    return status;
  }

  /**
   * Parse dependencies from issue body
   * Looks for patterns like:
   * - Depends on: #34, #35
   * - Dependencies: CORE-001, CORE-002
   * - Requires: #34 (CORE-001)
   */
  parseDependencies(body) {
    const dependencies = [];
    const lines = body.split('\n');
    
    // Find dependency section
    let inDependencySection = false;
    for (const line of lines) {
      // Check if we're in the dependencies section
      if (line.match(/^##\s*Dependencies/i)) {
        inDependencySection = true;
        continue;
      }
      
      // Stop if we hit another section
      if (inDependencySection && line.match(/^##\s/)) {
        break;
      }
      
      // Parse dependencies in the section
      if (inDependencySection) {
        // Match issue numbers (#123)
        const issueMatches = line.matchAll(/#(\d+)/g);
        for (const match of issueMatches) {
          dependencies.push(parseInt(match[1]));
        }
        
        // Also match task IDs (CORE-001) for reference
        const taskMatches = line.matchAll(/([A-Z]+-\d+)/g);
        for (const _match of taskMatches) {
          // Store task IDs too, might be useful for logging
          // but we'll use issue numbers for actual checking
        }
      }
    }
    
    return [...new Set(dependencies)]; // Remove duplicates
  }

  /**
   * Check if a specific agent has completed their work on a task
   */
  isAgentWorkComplete(task, agentRole) {
    const labels = task.labels || [];
    return labels.some(label => {
      const labelName = typeof label === 'string' ? label : label.name;
      return labelName === `${agentRole}-done`;
    });
  }

  /**
   * Assign task to agent
   */
  assignTask(agentRole, issueNumber) {
    // Add label to indicate work in progress
    this.gh(`issue edit ${issueNumber} --add-label "${agentRole}-wip"`);
    
    // Add assignee (would need GitHub usernames configured)
    // For now, just use labels
    
    return true;
  }

  /**
   * Mark agent's work as complete
   */
  completeAgentWork(agentRole, issueNumber, branchName) {
    // Remove WIP label and add done label
    this.gh(`issue edit ${issueNumber} --remove-label "${agentRole}-wip" --add-label "${agentRole}-done"`);
    
    // Add completion comment with branch info
    this.gh(`issue comment ${issueNumber} --body "✅ ${agentRole.toUpperCase()} work completed\\nBranch: ${branchName}"`);
    
    return true;
  }

  /**
   * Create a new task issue from task definition
   */
  createTaskIssue(taskId, title, description, backlogPosition = null) {
    const body = `## Task: ${title}

${description}

## Metadata
${backlogPosition ? `Backlog Position: ${backlogPosition}` : 'Backlog Position: TBD'}

## Branches
_Branches will be listed here as work progresses_

## Dependencies
_List any dependencies here_

## Acceptance Criteria
_Define what constitutes completion_
`;

    const result = this.gh(`issue create --title "${taskId}: ${title}" --body "${body}" --label "task"`);
    return result ? true : false;
  }

  /**
   * Close completed task
   */
  closeTask(issueNumber) {
    this.gh(`issue close ${issueNumber} --comment "✅ Task completed and merged to main"`);
    
    // Trigger cleanup of TASK files for this issue across all worktrees
    const cleanupScript = path.join(this.projectRoot, '.claude/pipeline/lib/cleanup-closed-tasks.sh');
    try {
      if (require('fs').existsSync(cleanupScript)) {
        execSync(cleanupScript, { stdio: 'ignore' });
      }
    } catch (error) {
      // Ignore cleanup errors - not critical
    }
    
    return true;
  }

  /**
   * Get task details
   */
  getTaskDetails(issueNumber) {
    const issue = this.gh(`issue view ${issueNumber} --json number,title,body,labels,assignees,state`);
    return issue ? JSON.parse(issue) : null;
  }
}

// CLI interface
if (import.meta.main || (process.argv[1] && process.argv[1].endsWith('github-task-scheduler.mjs'))) {
  const scheduler = new GitHubTaskScheduler(path.join(__dirname, '../../..'));
  const command = process.argv[2];
  const args = process.argv.slice(3);

  switch (command) {
    case 'next-task':
      const agent = args[0];
      if (!agent) {
        console.error('Usage: github-task-scheduler next-task <agent>');
        process.exit(1);
      }
      const nextTask = scheduler.getNextTask(agent);
      if (nextTask) {
        console.log(`${nextTask.number}`);
      } else {
        console.log('No eligible tasks');
      }
      break;

    case 'assign':
      const [assignAgent, issueNumber] = args;
      if (!assignAgent || !issueNumber) {
        console.error('Usage: github-task-scheduler assign <agent> <issue-number>');
        process.exit(1);
      }
      const assigned = scheduler.assignTask(assignAgent, issueNumber);
      console.log(assigned ? 'Task assigned' : 'Assignment failed');
      break;

    case 'complete':
      const [completeAgent, completeIssue, branch] = args;
      if (!completeAgent || !completeIssue || !branch) {
        console.error('Usage: github-task-scheduler complete <agent> <issue-number> <branch-name>');
        process.exit(1);
      }
      const completed = scheduler.completeAgentWork(completeAgent, completeIssue, branch);
      console.log(completed ? 'Work completed' : 'Completion failed');
      break;

    case 'create':
      const [taskId, ...titleParts] = args;
      if (!taskId || titleParts.length === 0) {
        console.error('Usage: github-task-scheduler create <task-id> <title>');
        process.exit(1);
      }
      const created = scheduler.createTaskIssue(taskId, titleParts.join(' '), '');
      console.log(created ? 'Task created' : 'Creation failed');
      break;

    case 'details':
      const detailsIssue = args[0];
      if (!detailsIssue) {
        console.error('Usage: github-task-scheduler details <issue-number>');
        process.exit(1);
      }
      const details = scheduler.getTaskDetails(detailsIssue);
      console.log(JSON.stringify(details, null, 2));
      break;

    case 'list':
      const tasks = scheduler.getAllTasks();
      const allTasksWithState = scheduler.getAllTasksWithState();
      
      // Create a map for dependency checking
      const taskDataMap = new Map();
      allTasksWithState.forEach(task => {
        taskDataMap.set(task.number, task);
      });
      
      // Show agent filter if provided
      const agentFilter = args[0];
      
      // Filter out closed tasks and sort by backlog position
      tasks
        .filter(task => task.state === 'OPEN')
        .sort((a, b) => {
          const aPos = scheduler.parseBacklogPosition(a);
          const bPos = scheduler.parseBacklogPosition(b);
          return aPos - bPos;
        })
        .forEach(task => {
        const completionStatus = scheduler.parseLabels(task.labels || []);
        const dependencies = scheduler.parseDependencies(task.body);
        const backlogPos = scheduler.parseBacklogPosition(task);
        
        const status = [];
        if (completionStatus.architect) status.push('A✓');
        if (completionStatus.test) status.push('T✓');
        if (completionStatus.implementation) status.push('I✓');
        
        // Calculate per-agent dependency status
        let depStatus = '';
        if (dependencies.length > 0) {
          const agentDepStatus = {
            architect: [],
            test: [],
            implementation: []
          };
          
          // Check each dependency for each agent
          for (const depNum of dependencies) {
            const depTask = taskDataMap.get(depNum);
            if (!depTask) continue;
            
            // Check each agent's status on the dependency
            ['architect', 'test', 'implementation'].forEach(agent => {
              if (depTask.state === 'closed') {
                // Task closed, all agents satisfied
                return;
              }
              const agentDone = scheduler.isAgentWorkComplete(depTask, agent);
              if (!agentDone) {
                agentDepStatus[agent].push(depNum);
              }
            });
          }
          
          // Build status string
          const blockedAgents = [];
          if (agentDepStatus.architect.length > 0) 
            blockedAgents.push(`A:${agentDepStatus.architect.join(',')}`);
          if (agentDepStatus.test.length > 0) 
            blockedAgents.push(`T:${agentDepStatus.test.join(',')}`);
          if (agentDepStatus.implementation.length > 0) 
            blockedAgents.push(`I:${agentDepStatus.implementation.join(',')}`);
          
          if (blockedAgents.length > 0) {
            depStatus = ` 🔒 Blocked: ${blockedAgents.join(' ')}`;
          } else {
            depStatus = ` ✅ Deps met`;
          }
        }
        
        // Filter by agent if specified
        if (agentFilter) {
          const _agentInitial = agentFilter.charAt(0).toUpperCase();
          const hasWork = !completionStatus[agentFilter] && 
                         (agentFilter === 'architect' || 
                          (agentFilter === 'test' && completionStatus.architect) ||
                          (agentFilter === 'implementation' && completionStatus.architect && completionStatus.test));
          
          if (hasWork) {
            const posStr = backlogPos < 9999 ? `${backlogPos}.` : '--';
            console.log(`${posStr} #${task.number}: ${task.title} [${status.join(' ')}]${depStatus}`);
          }
        } else {
          const posStr = backlogPos < 9999 ? `${backlogPos}.` : '--';
          console.log(`${posStr} #${task.number}: ${task.title} [${status.join(' ')}]${depStatus}`);
        }
      });
      break;

    default:
      console.log('GitHub Issues Task Scheduler');
      console.log('Commands:');
      console.log('  next-task <agent>     - Get next task for agent');
      console.log('  assign <agent> <issue> - Assign task to agent');
      console.log('  complete <agent> <issue> <branch> - Mark agent work complete');
      console.log('  create <id> <title>   - Create new task issue');
      console.log('  details <issue>       - Get task details');
      console.log('  list                  - List all tasks');
  }
}

export default GitHubTaskScheduler;