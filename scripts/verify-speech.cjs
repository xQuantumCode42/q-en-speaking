const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
module.exports = async function verifySpeech() {
  const root = path.resolve(__dirname, "..");
  const required = [
    "whisper-cli.exe",
    "whisper.dll",
    "ggml.dll",
    "ggml-base.dll",
    "ggml-cpu.dll",
  ];
  for (const name of required) {
    if (!fs.existsSync(path.join(root, "native/whisper", name)))
      throw new Error(
        "Missing local speech runtime. Run npm run setup:speech before packaging.",
      );
  }
  const gpuDirectory = path.join(root, "native/whisper-cuda");
  if (fs.existsSync(gpuDirectory)) {
    for (const name of [
      "whisper-cli.exe",
      "whisper.dll",
      "ggml.dll",
      "ggml-base.dll",
      "ggml-cpu.dll",
      "ggml-cuda.dll",
      "cudart64_12.dll",
      "cublas64_12.dll",
      "cublasLt64_12.dll",
    ]) {
      if (!fs.existsSync(path.join(gpuDirectory, name)))
        throw new Error(`Incomplete CUDA speech runtime: ${name}`);
    }
  }
  const model = path.join(root, "native/models/ggml-small.en-q5_1.bin");
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(model)) hash.update(chunk);
  if (
    hash.digest("hex") !==
    "bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30"
  )
    throw new Error(
      "Local English model checksum mismatch. Run npm run setup:speech.",
    );
};
