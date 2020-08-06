## Important: Google Cloud Functions for Firebase

There may continue to be specific use-cases for firebase-queue, however if you're looking for a general purpose, scalable queueing system for Firebase then it is likely that building on top of [Google Cloud Functions for Firebase](https://firebase.google.com/docs/functions/) is the ideal route. 

# Firebase Queue [![Build Status](https://travis-ci.org/firebase/firebase-queue.svg?branch=master)](https://travis-ci.org/firebase/firebase-queue) [![Coverage Status](https://img.shields.io/coveralls/firebase/firebase-queue.svg?branch=master&style=flat)](https://coveralls.io/r/firebase/firebase-queue) [![GitHub version](https://badge.fury.io/gh/firebase%2Ffirebase-queue.svg)](http://badge.fury.io/gh/firebase%2Ffirebase-queue)

A fault-tolerant, multi-worker, multi-stage job pipeline built on the [Firebase Realtime
Database](https://firebase.google.com/docs/database/).

## Status

![Status: Frozen](https://img.shields.io/badge/Status-Frozen-yellow)

This repository is no longer under active development. No new features will be added and issues are not actively triaged. Pull Requests which fix bugs are welcome and will be reviewed on a best-effort basis.

If you maintain a fork of this repository that you believe is healthier than the official version, we may consider recommending your fork. Please open a Pull Request if you believe that is the case.


## Table of Contents

 * [Getting Started With Firebase](#getting-started-with-firebase)
 * [Downloading Firebase Queue](#downloading-firebase-queue)
 * [Documentation](#documentation)
 * [Contributing](#contributing)


## Getting Started With Firebase

Firebase Queue requires [Firebase](https://firebase.google.com/) in order to sync and store data.
Firebase is a suite of integrated products designed to help you develop your app, grow your user
base, and earn money. You can [sign up here for a free account](https://console.firebase.google.com/).


## Downloading Firebase Queue

You can download Firebase Queue via npm. You will also have to install Firebase separately (that is,
they are `peerDependencies`):

```bash
$ npm install firebase firebase-queue --save
```


## Documentation

* [Guide](docs/guide.md)


## Contributing

If you'd like to contribute to Firebase Queue, please first read through our [contribution
guidelines](.github/CONTRIBUTING.md). Local setup instructions are available [here](.github/CONTRIBUTING.md#local-setup).
