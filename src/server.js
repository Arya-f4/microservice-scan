const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const Queue = require('bull');
const pLimit = require('p-limit');
const config = require('./config');

// Buat antrean baru dengan Bull dan Redis
const scanQueue = new Queue('scan', {
  redis: {
    host: config.redis.host,
    port: config.redis.port,
  },
});

// Batasi jumlah concurrent processes menjadi 3
const limit = pLimit(3);

const app = express();
app.use(express.json());

let cancelFlags = {}; // To keep track of job cancellation

// API untuk mengirim permintaan scan
app.post('/scan', async (req, res) => {
  const url = req.body.url;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Tambahkan job ke antrean
  const job = await scanQueue.add({ url });

  // Set up a cancellation flag
  cancelFlags[job.id] = false;

  // Kembalikan ID job sebagai respons
  return res.json({ jobId: job.id });
});

// API untuk mendapatkan hasil scan
app.get('/results/:jobId', async (req, res) => {
  const jobId = req.params.jobId;
  const job = await scanQueue.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Cek status job dan kembalikan hasil jika selesai
  const state = await job.getState();
  if (state === 'completed') {
    return res.json({ results: job.returnvalue });
  } else {
    return res.json({ status: state });
  }
});

// API untuk membatalkan job
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

// Proses pekerjaan dalam antrean dengan limitasi
scanQueue.process(async (job) => {
  const { url } = job.data;
  const outputFile = path.resolve(`/app/output-${job.id}.txt`);

  // Batasi jumlah concurrent processes
  return limit(() => {
    return new Promise((resolve, reject) => {
      const command = `nuclei -u ${url} -o ${outputFile} -t /path/to/templates`;
      const process = exec(command);

      process.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
        // Optionally, you can use this to update the job progress in Redis or another store
      });

      process.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
      });

      process.on('close', (code) => {
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
          reject(`Nuclei process exited with code ${code}`);
        }
      });
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
