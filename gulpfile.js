/*!
 * mio-mongo
 * https://github.com/mio/mongo
 */

'use strict';

var buffer = require('vinyl-buffer');
var coveralls = require('gulp-coveralls');
var gulp = require('gulp');
var mocha = require('gulp-mocha');
var instrument = require('gulp-instrument');
var jsdoc2md = require('gulp-jsdoc-to-markdown');
var fs = require('fs');
var source = require('vinyl-source-stream');
var spawn = require('child_process').spawn;
var clean = require('gulp-clean');
var rename = require('gulp-rename');

gulp.task('test', function () {
  return gulp.src('test/**/*.js')
    .pipe(mocha({
      timeout: 6000,
      ignoreLeaks: false,
      ui: 'bdd',
      reporter: 'spec'
    }));
});

gulp.task('instrument', function() {
  return gulp.src('lib/**/*.js')
    .pipe(instrument())
    .pipe(gulp.dest('lib-cov'));
});

gulp.task('docs', function () {
  return gulp.src('./lib/*.js')
    .pipe(jsdoc2md({
      template: fs.readFileSync('./lib/README_template.md.hbs', 'utf8')
    }))
    .pipe(rename({
      basename: 'README',
      extname: '.md'
    }))
    .pipe(gulp.dest('./'));
});

gulp.task('coverage', ['instrument'], function() {
  process.env.JSCOV = true;
  return spawn('./node_modules/gulp-mocha/node_modules/mocha/bin/mocha', [
    'test', '--reporter', 'html-cov'
  ]).stdout
    .pipe(source('coverage.html'))
    .pipe(gulp.dest('./'));
});

gulp.task('coveralls', ['instrument'], function(done) {
  if (!process.env.COVERALLS_REPO_TOKEN) {
    return done(new Error("No COVERALLS_REPO_TOKEN set."));
  }

  process.env.JSCOV=1;

  var err = '';

  var mocha = spawn('node_modules/gulp-mocha/node_modules/mocha/bin/mocha', [
    'test', '--reporter', 'mocha-lcov-reporter'
  ]);

  mocha.stderr.on('data', function(chunk) {
    err += chunk;
  });

  mocha.stdout
    .pipe(source('lcov.json'))
    .pipe(buffer())
    .pipe(coveralls());

  mocha.on('close', function(code) {
    if (code) {
      if (err) return done(new Error(err));

      return done(new Error(
        "Failed to send lcov data to coveralls."
      ));
    }

    done();
  });
});

gulp.task('watch', ['test'], function () {
  gulp.watch(['lib/**/*.js', 'test/**/*.js'], ['test']);
});

gulp.task('clean', function() {
  return gulp.src(['lib-cov', 'coverage.html', 'npm-debug.log']).pipe(clean());
});

gulp.task('default', ['watch']);
