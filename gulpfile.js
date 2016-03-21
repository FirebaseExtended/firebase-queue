/**************/
/*  REQUIRES  */
/**************/
var gulp = require('gulp');

// File I/O
var exit = require('gulp-exit');
var jshint = require('gulp-jshint');

// Testing
var mocha = require('gulp-mocha');
var istanbul = require('gulp-istanbul');


/****************/
/*  FILE PATHS  */
/****************/
var paths = {
  js: {
    srcFiles: [
      'src/**/*.js'
    ],
    destDir: 'dist'
  },

  tests: [
    'test/queue.spec.js',
    'test/lib/queue_worker.spec.js'
  ]
};


/***********/
/*  TASKS  */
/***********/
// Lints the JavaScript files and copies them to the destination directory
gulp.task('build', function() {
  return gulp.src(paths.js.srcFiles)
    .pipe(jshint())
    .pipe(jshint.reporter('jshint-stylish'))
    .pipe(jshint.reporter('fail'))
    .on('error', function(error) {
      throw error;
    })
    .pipe(gulp.dest(paths.js.destDir));
});

// Runs the Mocha test suite
gulp.task('test', function() {
  return gulp.src(paths.js.srcFiles)
    .pipe(istanbul())
    .pipe(istanbul.hookRequire())
    .on('finish', function () {
      gulp.src(paths.tests)
        .pipe(mocha({
          reporter: 'spec',
          timeout: 5000
        }))
        .pipe(istanbul.writeReports())
        .pipe(exit());
    });
});

// Default task
gulp.task('default', ['build', 'test']);
