#!/usr/bin/env node

// --- OxyGen Publisher v1.2 ---
// A CLI tool to easily publish and update wallpapers and clock themes.
// Pins dependencies to ensure CommonJS compatibility.

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const AdmZip = require('adm-zip');
// --- Correctly handle module requires ---
const inquirer = require('inquirer');
const chalk = require('chalk');
const isWindows = require('is-windows');

// ============================================================================
// --- ⚙️ CONFIGURATION - PLEASE EDIT THIS SECTION ---
// ============================================================================
// ... (Your configuration remains the same) ...
const GITHUB_USERNAME = 'Adaxhhh';
const GITHUB_REPO_NAME = 'Depthify-Wallpaper-Repo';
const REPO_ROOT = path.resolve(__dirname, '..');

// ============================================================================
// --- END OF CONFIGURATION ---
// ============================================================================

// ... (The rest of the script is IDENTICAL to the previous version) ...
// ... NO OTHER CODE CHANGES ARE NEEDED IN THE SCRIPT FILE ITSELF ...

// --- Derived Paths (Do not edit) ---
const WALLPAPER_JSON_PATH = path.join(REPO_ROOT, 'update.json');
const CLOCK_JSON_PATH = path.join(REPO_ROOT, 'updateClock.json');
const WALLPAPERS_DIR = path.join(REPO_ROOT, 'wallpapers');
const CLOCKS_DIR = path.join(REPO_ROOT, 'clocks');
const PREVIEWS_DIR = path.join(REPO_ROOT, 'previews');
const CLOCK_PREVIEWS_DIR = path.join(REPO_ROOT, 'clock_previews');
const GITHUB_REPO_BASE_URL = `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${GITHUB_REPO_NAME}/main/`;

// --- UI Helper: Emojis with Fallbacks ---
const ui = {
    rocket: isWindows() ? '>>' : '🚀',
    magnify: isWindows() ? '>>' : '🔍',
    cross: isWindows() ? '[x]' : '❌',
    check: isWindows() ? '[v]' : '✅',
    warn: isWindows() ? '[!]' : '⚠️',
    package: isWindows() ? '[P]' : '📦',
    commit: isWindows() ? '>>' : '📝',
    push: isWindows() ? '>>' : '📤',
    star: isWindows() ? '*' : '✨',
    recycle: isWindows() ? '>>' : '♻️',
    clock: isWindows() ? '>>' : '⏳',
};

function runCommand(cmd, cwd = REPO_ROOT) {
    return new Promise((resolve, reject) => {
        exec(cmd, { cwd }, (error, stdout, stderr) => {
            if (error) {
                console.error(chalk.red(`\n${ui.cross} Error executing: ${cmd}\n${stderr}`));
                return reject(error);
            }
            if (stderr && !stderr.includes('Cloning into') && !stderr.includes('Applying:')) {
                console.warn(chalk.yellow(`\n${ui.warn} Stderr: ${stderr}`));
            }
            resolve(stdout.trim());
        });
    });
}

async function getFileSizeInMB(filePath) {
    const stats = await fs.stat(filePath);
    return parseFloat((stats.size / (1024 * 1024)).toFixed(2));
}

async function checkGitignore() {
    const gitignorePath = path.join(REPO_ROOT, '.gitignore');
    try {
        await fs.access(gitignorePath);
    } catch {
        const { createGitignore } = await inquirer.prompt([{
            type: 'confirm',
            name: 'createGitignore',
            message: chalk.yellow(`${ui.warn} .gitignore file not found. It's recommended to create one to ignore 'tools/node_modules'. Create it now?`),
            default: true,
        }]);
        if (createGitignore) {
            await fs.writeFile(gitignorePath, 'tools/node_modules/\n');
            console.log(chalk.green(`${ui.check} .gitignore created and configured.`));
            // This needs to be committed. We'll handle this in the checkGitStatus function.
        }
    }
}

async function checkGitStatus() {
    console.log(chalk.blue(`${ui.magnify} Checking repository status...`));
    await checkGitignore();
    
    // Add the .gitignore to be tracked if it's new
    const gitignoreStatus = await runCommand(`git status --porcelain .gitignore`);
    if (gitignoreStatus.startsWith('??')) {
        console.log(chalk.blue('Adding new .gitignore file to version control...'));
        await runCommand('git add .gitignore');
        await runCommand('git commit -m "chore: Add .gitignore for tools"');
        console.log(chalk.green(`${ui.check} Committed .gitignore.`));
    }

    const status = await runCommand('git status --porcelain');
    if (status) {
        console.warn(chalk.yellow(`\n${ui.warn} Your repository has other uncommitted changes:`));
        console.log(chalk.gray(status));
        const { stashChanges } = await inquirer.prompt([{
            type: 'confirm',
            name: 'stashChanges',
            message: 'Do you want to temporarily stash these changes to proceed?',
            default: true,
        }]);
        if (stashChanges) {
            console.log(chalk.blue('Stashing changes...'));
            await runCommand('git stash');
            return true; // Indicates that changes were stashed
        } else {
            console.error(chalk.red(`${ui.cross} Publishing cancelled. Please commit or stash your changes manually.`));
            process.exit(1);
        }
    }
    console.log(chalk.green(`${ui.check} Repository is clean.`));
    return false; // No changes were stashed
}

async function main() {
    let wasStashed = false;
    try {
        console.log('====================================');
        console.log(chalk.bold.cyan(`${ui.rocket} Welcome to the OxyGen Publisher!`));
        console.log('====================================\n');

        wasStashed = await checkGitStatus();

        const { shouldPull } = await inquirer.prompt([{
            type: 'confirm', name: 'shouldPull',
            message: 'Pull the latest changes from GitHub first? (Recommended)',
            default: true,
        }]);

        if (shouldPull) {
            console.log(chalk.blue('\nPulling latest changes from origin/main...'));
            await runCommand('git pull origin main');
            console.log(chalk.green(`${ui.check} Pull complete.\n`));
        }

        const answers = await inquirer.prompt([
            { type: 'list', name: 'itemType', message: 'What are you publishing?', choices: ['Wallpaper', 'Clock'], },
            { type: 'input', name: 'id', message: 'Enter a unique Theme ID (e.g., aurora-blast):', filter: input => input.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''), validate: input => !!input || 'Theme ID cannot be empty.', },
            { type: 'input', name: 'name', message: 'Enter the display name (e.g., Aurora Blast):', validate: input => !!input || 'Display name cannot be empty.', },
            { type: 'input', name: 'description', message: 'Enter a short description:', default: 'A beautiful new theme for OxyGen.' },
            { type: 'input', name: 'author', message: 'Enter the author\'s name:', default: 'OxyGen Team', },
            { type: 'input', name: 'tags', message: 'Enter tags (comma-separated):', filter: input => input.split(',').map(tag => tag.trim()).filter(Boolean), },
            { type: 'input', name: 'previewImagePath', message: 'Drag and drop the preview image file here, then press Enter:', validate: async input => { const p = input.trim().replace(/^['"]|['"]$/g, ''); try { await fs.access(p); return true; } catch { return 'File does not exist.'; } }, filter: input => input.trim().replace(/^['"]|['"]$/g, ''), },
            { type: 'input', name: 'resolutionOrVariant', message: 'Enter the Resolution (e.g., 1920x1080) or Clock Variant (e.g., Default):', validate: input => !!input || 'This field cannot be empty.', },
            { type: 'input', name: 'sourceFolderPath', message: 'Drag and drop the theme\'s SOURCE FOLDER here, then press Enter:', validate: async input => { const p = input.trim().replace(/^['"]|['"]$/g, ''); try { const s = await fs.stat(p); return s.isDirectory() || 'Path is not a directory.'; } catch { return 'Folder does not exist.'; } }, filter: input => input.trim().replace(/^['"]|['"]$/g, ''), },
            { type: 'confirm', name: 'isCustomizable', message: 'Is this a customizable Clock theme?', default: false, when: (ans) => ans.itemType === 'Clock', },
        ]);

        const { itemType, id, name, description, author, tags, previewImagePath, resolutionOrVariant, sourceFolderPath, isCustomizable } = answers;
        const catalogPath = itemType === 'Wallpaper' ? WALLPAPER_JSON_PATH : CLOCK_JSON_PATH;
        const itemDir = itemType === 'Wallpaper' ? WALLPAPERS_DIR : CLOCKS_DIR;
        const previewTargetDir = itemType === 'Wallpaper' ? PREVIEWS_DIR : CLOCK_PREVIEWS_DIR;
        const catalogKey = itemType === 'Wallpaper' ? 'themes' : 'clockThemes';

        console.log(chalk.cyan('\n---------------------------------'));
        console.log(chalk.cyan.bold(`${ui.package} Starting Publishing Process...`));
        console.log(chalk.cyan('---------------------------------\n'));

        // 1. Create Zip File
        const zipFileName = `${id}_${resolutionOrVariant.replace(/[^a-zA-Z0-9_.-]/g, '_')}.zip`;
        const themeZipDestinationDir = path.join(itemDir, id);
        await fs.mkdir(themeZipDestinationDir, { recursive: true });
        const zipFilePath = path.join(themeZipDestinationDir, zipFileName);

        console.log(chalk.blue(`[1/4] Zipping folder: ${sourceFolderPath}`));
        const zip = new AdmZip();
        zip.addLocalFolder(sourceFolderPath);
        zip.writeZip(zipFilePath);
        const sizeMB = await getFileSizeInMB(zipFilePath);
        console.log(chalk.green(`      ${ui.check} Zip created at: ${path.relative(REPO_ROOT, zipFilePath)} (${sizeMB} MB)`));

        // 2. Copy Preview Image
        const previewExt = path.extname(previewImagePath);
        const previewFileName = `${id}_preview${previewExt}`;
        const finalPreviewPath = path.join(previewTargetDir, previewFileName);
        await fs.mkdir(previewTargetDir, { recursive: true });
        await fs.copyFile(previewImagePath, finalPreviewPath);
        const previewUrl = GITHUB_REPO_BASE_URL + path.relative(REPO_ROOT, finalPreviewPath).replace(/\\/g, '/');
        console.log(chalk.blue(`\n[2/4] Copying preview image...`));
        console.log(chalk.green(`      ${ui.check} Preview saved to: ${path.relative(REPO_ROOT, finalPreviewPath)}`));

        // 3. Update JSON Catalog
        console.log(chalk.blue(`\n[3/4] Updating catalog file: ${path.basename(catalogPath)}`));
        let catalog = { [catalogKey]: [] };
        try {
            catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
        } catch (error) {
            console.warn(chalk.yellow(`      ${ui.warn} Catalog file not found or invalid. A new one will be created.`));
        }

        let themeEntry = catalog[catalogKey].find(t => t.id === id);

        if (!themeEntry) {
            themeEntry = { id, name, description, author, tags, previewUrl, resolutions: [] };
            if (itemType === 'Clock') themeEntry.isCustomizable = isCustomizable;
            catalog[catalogKey].push(themeEntry);
            console.log(chalk.green(`      ${ui.star} New ${itemType.toLowerCase()} '${id}' added to catalog.`));
        } else {
            console.log(chalk.green(`      ${ui.recycle} Updating metadata for existing ${itemType.toLowerCase()} '${id}'.`));
            Object.assign(themeEntry, { name, description, author, tags, previewUrl });
            if (itemType === 'Clock') themeEntry.isCustomizable = isCustomizable;
        }

        let resolutionEntry = themeEntry.resolutions.find(r => r.resolution === resolutionOrVariant);
        const newDownloadUrl = GITHUB_REPO_BASE_URL + path.relative(REPO_ROOT, zipFilePath).replace(/\\/g, '/');

        if (!resolutionEntry) {
            resolutionEntry = { resolution: resolutionOrVariant, downloadUrl: newDownloadUrl, version: 1, sizeMB };
            themeEntry.resolutions.push(resolutionEntry);
            console.log(chalk.green(`      ${ui.star} New resolution/variant '${resolutionOrVariant}' added.`));
        } else {
            resolutionEntry.version = (resolutionEntry.version || 0) + 1;
            resolutionEntry.downloadUrl = newDownloadUrl;
            resolutionEntry.sizeMB = sizeMB;
            console.log(chalk.green(`      ${ui.recycle} Updated resolution/variant '${resolutionOrVariant}' to version ${resolutionEntry.version}.`));
        }

        await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2), 'utf8');
        console.log(chalk.green(`      ${ui.check} Catalog file successfully written.`));

        // 4. Git Operations
        console.log(chalk.blue(`\n[4/4] Committing and pushing to GitHub...`));
        await runCommand(`git add .`); // Use 'git add .' to also catch new directories

        const commitMessage = `Publish ${itemType}: ${name} - ${resolutionOrVariant} (v${resolutionEntry.version})`;
        await runCommand(`git commit -m "${commitMessage}"`);
        console.log(chalk.green(`      ${ui.commit} Changes committed with message: "${commitMessage}"`));

        console.log(chalk.blue(`      ${ui.clock} Pushing to origin/main...`));
        await runCommand('git push origin main');

        console.log(chalk.cyan('\n---------------------------------'));
        console.log(chalk.cyan.bold(`🎉 PUBLISHING COMPLETE! 🎉`));
        console.log(chalk.cyan('---------------------------------\n'));

    } catch (error) {
        // This catch block will only execute if an inquirer prompt itself fails or another unhandled error occurs
        if(error.isTtyError) {
             console.error(chalk.red.bold('\n❌ --- PUBLISHING FAILED --- ❌'));
             console.error(chalk.red('Could not render prompts in this terminal.'));
        } else {
             console.error(chalk.red.bold('\n❌ --- PUBLISHING FAILED --- ❌'));
             console.error(chalk.red('An unexpected error occurred:'));
             console.error(chalk.gray(error.message));
        }
    } finally {
        if (wasStashed) {
            console.log(chalk.blue('\nRestoring your previously stashed changes...'));
            try {
                await runCommand('git stash pop');
                console.log(chalk.green(`${ui.check} Stash restored successfully.`));
            } catch (e) {
                console.warn(chalk.yellow(`${ui.warn} Could not automatically restore stash. A merge conflict may have occurred.`));
                console.warn(chalk.yellow('Please run `git stash pop` manually to resolve it.'));
            }
        }
    }
}

// We wrap the main call in a self-executing async function to handle top-level awaits and errors
(async () => {
    try {
        await main();
    } catch (error) {
        // This catches errors from the main function, like if an inquirer prompt fails
        if (error.isTtyError) {
            console.error(chalk.red.bold('\n❌ Error: Prompt could not be rendered in this environment.'));
        } else {
            console.error(chalk.red.bold('\n❌ An unexpected error occurred in the main process:'), error);
        }
    }
})();