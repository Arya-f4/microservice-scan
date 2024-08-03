// src/server.mjs
import express from 'express';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import Queue from 'bull';
import { redisConfig } from './config.js';

// Create new queue with Bull and Redis
const scanQueue = new Queue('scan', {
  redis: redisConfig,
});

// Limit concurrent processes
const MAX_CONCURRENT_PROCESSES = 3;
let currentConcurrentProcesses = 0;

const app = express();
app.use(express.json());

let cancelFlags = {}; // To keep track of job cancellation

// API to start Nuclei scan
app.post('/nuclei/scan', async (req, res) => {
  const url = req.body.url;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Add job to queue
  const job = await scanQueue.add({ url, type: 'nuclei' });

  // Set up a cancellation flag
  cancelFlags[job.id] = false;

  // Return job ID as response
  return res.json({ jobId: job.id });
});

// API to start WPScan
app.post('/wpscan/scan', async (req, res) => {
  const url = req.body.url;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Add job to queue
  const job = await scanQueue.add({ url, type: 'wpscan' });

  // Set up a cancellation flag
  cancelFlags[job.id] = false;

  // Return job ID as response
  return res.json({ jobId: job.id });
});

// API to get scan results
app.get('/results/:jobId', async (req, res) => {
  const jobId = req.params.jobId;
  const job = await scanQueue.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Check job state and return results if completed
  const state = await job.getState();
  if (state === 'completed') {
    return res.json({ results: job.returnvalue });
  } else {
    return res.json({ status: state });
  }
});

// API to cancel job
app.delete('/results/:jobId', async (req, res) => {
  const jobId = req.params.jobId;
  const job = await scanQueue.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Mark job as canceled
  cancelFlags[jobId] = true;

  // Attempt to remove job
  await job.remove();

  return res.json({ message: 'Job cancellation requested' });
});

// Process jobs with concurrency control
scanQueue.process(async (job) => {
  if (currentConcurrentProcesses >= MAX_CONCURRENT_PROCESSES) {
    throw new Error('Too many concurrent processes');
  }

  currentConcurrentProcesses++;

  try {
    const { url, type } = job.data;
    const outputFile = path.resolve(`/app/output-${job.id}.txt`);

    return new Promise((resolve, reject) => {
      let command;
      if (type === 'nuclei') {
        command = `nuclei -u ${url} -o ${outputFile} -t /root/nuclei-templates`;
      } else if (type === 'wpscan') {
        command = `wpscan --url ${url} --output ${outputFile}`;
      } else {
        return reject('Unknown scan type');
      }
      

      const process = exec(command);

      process.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
      });

      process.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
      });

      process.on('close', (code) => {
        currentConcurrentProcesses--;

        if (cancelFlags[job.id]) {
          return reject('Job canceled');
        }

        if (code === 0) {
          fs.readFile(outputFile, 'utf8', (err, data) => {
            if (err) {
              console.error(`readFile error: ${err}`);
              return reject('Failed to read scan results');
            }
            resolve(data);
          });
        } else {
          reject(`${type} process exited with code ${code}`);
        }
      });
    });
  } catch (error) {
    currentConcurrentProcesses--;
    throw error;
  }
});

const PORT = process.env.PORT || 9020;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
