const path = require("path");
const fs = require('fs');

const registryDir = "/registry";

const v2Path = path.join(registryDir, "data/docker/registry/v2");

// === NEW VERSION

const digests = {};
const architecture = {};

function addDigestWithPath(digest, path) {
    if (digests[digest] == undefined) {
        digests[digest] = new Set();
    }
    digests[digest].add(path);
}

async function getAllBlobsWithPath(blobsPath) {
    return new Promise((resolve, reject) => {
        fs.readdir(blobsPath, async (err, dirs) => {
            if (err) {
                console.log("Can't get all blobs repositories", err);
                reject();
                return
            }

            const promisesTable = [];

            for (let dir of dirs) {
                promisesTable.push(new Promise((resolve, reject) => {
                    const tempDir = path.join(blobsPath, dir)
                    fs.readdir(tempDir, (err, digests) => {
                        if (err) {
                            console.log("Can't get digests from blobs", err);
                            reject();
                            return
                        }

                        for (let digest of digests) {
                            addDigestWithPath(digest, path.join(tempDir, digest));
                        }

                        resolve();
                    });
                }));
            }

            let error = false;
            await Promise.all(promisesTable).catch(() => {error = true});
            if (error) {
                reject();
                return
            }

            resolve();
        });
    });
}

async function getAllDigestsFromTag(tagRepository) {
    return new Promise((resolve, reject) => {
        // index folder
        const indexPath = path.join(tagRepository, "index/sha256");
        fs.readdir(indexPath, (err, digests) => {
            if (err) {
                console.log("Can't get index in tag", err);
                reject();
                return
            }

            for (let digest of digests) {
                addDigestWithPath(digest, path.join(indexPath, digest));
            }

            resolve();
        });
    });
}

async function getAllDigestsFromRepository(repositoryPath) {
    return new Promise((resolve, reject) => {
        let count = 0;
        // _layers folder
        const layersPath = path.join(repositoryPath, "_layers/sha256");
        fs.readdir(layersPath, (err, digests) => {
            if (err) {
                console.log("Can't get layers in repository", err);
                reject();
                return
            }

            for (let digest of digests) {
                addDigestWithPath(digest, path.join(layersPath, digest));
            }

            if (++count == 3) {
                resolve();
            }
        });

        // _manifests/revisions folder
        const revisionsPath = path.join(repositoryPath, "_manifests/revisions/sha256");
        fs.readdir(revisionsPath, (err, digests) => {
            if (err) {
                console.log("Can't get revisions in repository", err);
                reject();
                return
            }

            for (let digest of digests) {
                addDigestWithPath(digest, path.join(revisionsPath, digest));
            }

            if (++count == 3) {
                resolve();
            }
        });

        // _manifests/revisions folder
        const tagsPath = path.join(repositoryPath, "_manifests/tags");
        fs.readdir(tagsPath, async (err, tags) => {
            if (err) {
                console.log("Can't get tags in repository", err);
                reject();
                return
            }

            let promisesTable = [];

            for (let tag of tags) {
                promisesTable.push(new Promise((resolve, reject) => {
                    getAllDigestsFromTag(path.join(tagsPath, tag)).then(resolve).catch(reject);
                }));
            }

            let error = false;
            await Promise.all(promisesTable).catch(() => {error = true});
            if (error) {
                reject();
                return
            }

            if (++count == 3) {
                resolve();
            }
        });
    });
}

async function getAllDigestsFromRepositories(repositoriesPath) {
    return new Promise((resolve, reject) => {
        fs.readdir(repositoriesPath, async (err, dirs) => {
            if (err) {
                console.log("Can't get repositories list", err);
                reject();
                return
            }

            const promisesTable = [];

            for (let dir of dirs) {
                promisesTable.push(new Promise((resolve, reject) => {
                    getAllDigestsFromRepository(path.join(repositoriesPath, dir)).then(resolve).catch(reject);
                }));
            }

            await Promise.all(promisesTable).then(resolve).catch(reject);
        });
    });
}

async function getAllDigestsWithPath(v2Path) {
    return new Promise(async (resolve, reject) => {

        const promisesTable = [];

        const blobsPath = path.join(v2Path, "blobs/sha256");
        promisesTable.push(new Promise((resolve, reject) => {
            getAllBlobsWithPath(blobsPath).then(resolve).catch(reject);
        }));

        const repositoriesPath = path.join(v2Path, "repositories");
        promisesTable.push(new Promise((resolve, reject) => {
            getAllDigestsFromRepositories(repositoriesPath).then(resolve).catch(reject);
        }));

        await Promise.all(promisesTable).then(resolve).catch(reject);
    });
}

async function buildManifestsArchitecture(manifest, architecture) {
    return new Promise((resolve, reject) => {
        // Find manifest path
        if (digests[manifest] == undefined) {
            resolve();
            return
        }

        let manifestPath;

        for (let path of digests[manifest]) {
            if (path.includes("blobs")) {
                manifestPath = path;
                break
            }
        }

        if (manifestPath == undefined) {
            resolve();
            return
        }

        const manifestFile = path.join(manifestPath, "data");
        architecture.manifests.add(manifest);
        architecture.digests.add(manifest);

        // Check if manifest is a manifest list
        fs.readFile(manifestFile, 'utf8', async (err, data) => {
            if (err) {
                console.log("Can't get manifest file", manifestFile, err);
                reject();
                return;
            }

            data = JSON.parse(data);

            if (data.config != undefined) {
                architecture.configs.add(data.config.digest.replace("sha256:", ""));
                architecture.digests.add(data.config.digest.replace("sha256:", ""));
            }

            if (data.manifests != undefined) {
                let promisesTable = [];

                for (let manifest of data.manifests) {
                    promisesTable.push(new Promise((resolve, reject) => {
                        buildManifestsArchitecture(manifest.digest.replace("sha256:", ""), architecture).then(resolve).catch(reject);
                    }));
                }

                let error = false;
                await Promise.all(promisesTable).catch((err) => {console.log(err); error = true});
                if (error) {
                    reject();
                    return
                }
            }

            if (data.layers != undefined) {
                for (let layer of data.layers) {
                    architecture.layers.add(layer.digest.replace("sha256:", ""));
                    architecture.digests.add(layer.digest.replace("sha256:", ""));
                }
            }

            resolve();
        });
    });
}

async function getTagArchitecture(tagPath, architecture) {
    return new Promise((resolve, reject) => {
        const currentFile = path.join(tagPath, "current/link");
        architecture.manifests = new Set();
        architecture.configs = new Set();
        architecture.layers = new Set();
        architecture.digests = new Set();

        fs.readFile(currentFile, 'utf8', (err, data) => {
            if (err) {
                console.log("Can't get current file", err);
                reject();
                return;
            }

            buildManifestsArchitecture(data.replace("sha256:", ""), architecture).then(resolve).catch(reject);
        });
    });
}

async function getImageArchitecture(imagePath, architecture) {
    return new Promise((resolve, reject) => {
        const tagsPath = path.join(imagePath, "_manifests/tags");
        fs.readdir(tagsPath, async (err, tags) => {
            if (err) {
                console.log("Can't get tags list of image", err);
                reject();
                return
            }

            const promisesTable = [];

            for (let tag of tags) {
                architecture[tag] = {};
                promisesTable.push(new Promise((resolve, reject) => {
                    getTagArchitecture(path.join(tagsPath, tag), architecture[tag]).then(resolve).catch(reject);
                }));
            }

            await Promise.all(promisesTable).then(resolve).catch(reject);
        });
    });
}

async function getAllImages(imagesRepository) {
    return new Promise((resolve, reject) => {
        fs.readdir(imagesRepository, async (err, images) => {
            if (err) {
                console.log("Can't get images list", err);
                reject();
                return
            }

            const promisesTable = [];

            for (let image of images) {
                architecture[image] = {};
                promisesTable.push(new Promise((resolve, reject) => {
                    getImageArchitecture(path.join(imagesRepository, image), architecture[image]).then(resolve).catch(reject);
                }));
            }

            await Promise.all(promisesTable).then(resolve).catch(reject);
        });
    });
}

async function garbageCollector() {
    await getAllDigestsWithPath(v2Path);

    await getAllImages(path.join(v2Path, "repositories"));

    const digestsToRemove = new Set(Object.keys(digests));
    for (let image in architecture) {
        for (let tag in architecture[image]) {
            for (let digest of architecture[image][tag].digests) {
                digestsToRemove.delete(digest);
            }
        }
    }

    let promisesTable = [];
    for (let digest of digestsToRemove) {
        for (let path of digests[digest]) {
            promisesTable.push(new Promise(async (resolve, reject) => {
                fs.rm(path, { recursive: true, force: true }, (err) => {
                    if (err) {
                        console.log("Can't remove folder ", path, err);
                        reject();
                    } else {
                        resolve();
                    }
                });
            }));
        }
    }

    await Promise.all(promisesTable).catch((err) => console.log(err));

    return Promise.resolve();
}


setInterval(() => {
    garbageCollector();
}, process.env.GC_INTERVAL);