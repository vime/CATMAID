/* -*- mode: espresso; espresso-indent-level: 8; indent-tabs-mode: t -*- */

(function(CATMAID) {

  "use strict";

  /** orientations */
  Stack.ORIENTATION_XY = 0;
  Stack.ORIENTATION_XZ = 1;
  Stack.ORIENTATION_ZY = 2;

  /**
   * A Stack is created with a given pixel resolution, pixel dimension, a
   * translation relative to the project and lists of planes to be excluded
   * (e.g. missing sections in serial section microscopy and missing frames in a
   * time series).
   */
  function Stack(
      id,             //!< {Integer} the stack's id
      title,            //!< {String} the stack's title
      dimension,          //!< {Array} pixel dimensions [x, y, z, ...]
      resolution,         //!< {Array} physical resolution in units/pixel [x, y, z, ...]
      translation,        //!< @todo replace by an affine transform
      skip_planes,        //!< {Array} planes to be excluded from the stack's view [[z,t,...], [z,t,...], ...]
      num_zoom_levels,      //!< {int} that defines the number of available non-artificial zoom levels
      max_zoom_level,       //!< {int} that defines the maximum available zoom level
      description,         //!< {String} of arbitrary meta data
      metadata,
      orientation,         //!< {Integer} orientation (0: xy, 1: xz, 2: yz)
      canaryLocation,
      placeholderColor,
      mirrors
    ) {
    // initialize
    var self = this;

    self.id = id;
    self.title = title;
    self.resolution = resolution;
    self.translation = translation;
    self.dimension = dimension;

    // all possible slices
    self.slices = [];
    self.broken_slices = [];
    for ( var i = 0; i < dimension.z; ++i )
    {
      if ( !skip_planes[ i ] )
        self.slices.push( i );
      else
        self.broken_slices.push( i );
    }

    var MAX_X = dimension.x - 1;   //!< the last possible x-coordinate
    var MAX_Y = dimension.y - 1;   //!< the last possible y-coordinate
    var MAX_Z = dimension.z - 1;   //!< the last possible z-coordinate
    self.MAX_X = MAX_X;
    self.MAX_Y = MAX_Y;
    self.MAX_Z = MAX_Z;

    //! estimate the zoom levels
    if ( num_zoom_levels < 0 ) {
      self.MAX_S = 0;
      var max_dim = Math.max( MAX_X, MAX_Y );
      var min_size = 1024;
      while ( max_dim / Math.pow( 2, self.MAX_S ) > min_size )
        ++self.MAX_S;
    } else {
      self.MAX_S = num_zoom_levels;
    }
    self.MIN_S = max_zoom_level;

    self.description = description;
    self.metadata = metadata;
    self.orientation = orientation;
    self.canaryLocation = canaryLocation;
    self.placeholderColor = placeholderColor;
    self.mirrors = mirrors;
    self.mirrors.sort(function (a, b) {
      return a.position - b.position;
    });

    this.minPlanarRes = Math.min(resolution.x, resolution.y);
    /** @type {Object} Relative anisotropy of the planar dimensions. */
    this.anisotropy = Object.keys(resolution).reduce(function (ani, dim) {
      ani[dim] = resolution[dim] / self.minPlanarRes;
      return ani;
    }, {});

    /**
     * Project x-coordinate for stack coordinates
     */
    switch ( orientation )
    {
    case Stack.ORIENTATION_ZY:
      this.stackToProjectX = function( zs, ys, xs )
      {
        return zs * resolution.z + translation.x;
      };
      break;
    default:
      this.stackToProjectX = function( zs, ys, xs )
      {
        return xs * resolution.x + translation.x;
      };
    }

    /**
     * Project y-coordinate for stack coordinates
     */
    switch ( orientation )
    {
    case Stack.ORIENTATION_XZ:
      this.stackToProjectY = function( zs, ys, xs )
      {
        return zs * resolution.z + translation.y;
      };
      break;
    default:
      this.stackToProjectY = function( zs, ys, xs )
      {
        return ys * resolution.y + translation.y;
      };
    }

    /**
     * Project z-coordinate for stack coordinates
     */
    switch ( orientation )
    {
    case Stack.ORIENTATION_XZ:
      this.stackToProjectZ = function( zs, ys, xs )
      {
        return ys * resolution.y + translation.z;
      };
      break;
    case Stack.ORIENTATION_ZY:
      this.stackToProjectZ = function( zs, ys, xs )
      {
        return xs * resolution.x + translation.z;
      };
      break;
    default:
      this.stackToProjectZ = function( zs, ys, xs )
      {
        return zs * resolution.z + translation.z;
      };
    }


    /**
     * Stack x-coordinate from project coordinates, without clamping to the
     * stack bounds.
     */
    switch ( orientation )
    {
    case Stack.ORIENTATION_ZY:
      this.projectToUnclampedStackX = function( zp, yp, xp )
      {
        return ( zp - translation.z ) / resolution.x;
      };
      break;
    default:
      this.projectToUnclampedStackX = function( zp, yp, xp )
      {
        return ( xp - translation.x ) / resolution.x;
      };
    }

    /**
     * Stack x-coordinate from project coordinates, clamped to the stack
     * bounds.
     */
    this.projectToStackX = function( zp, yp, xp )
    {
      return Math.max( 0, Math.min( MAX_X, this.projectToUnclampedStackX( zp, yp, xp ) ) );
    };

    /**
     * Stack y-coordinate from project coordinates, without clamping to the
     * stack bounds.
     */
    switch ( orientation )
    {
    case Stack.ORIENTATION_XZ:
      this.projectToUnclampedStackY = function( zp, yp, xp )
      {
        return ( zp - translation.z ) / resolution.y;
      };
      break;
    default:  // xy
      this.projectToUnclampedStackY = function( zp, yp, xp )
      {
        return ( yp - translation.y ) / resolution.y;
      };
    }

    /**
     * Stack y-coordinate from project coordinates, clamped to the stack
     * bounds.
     */
    this.projectToStackY = function( zp, yp, xp )
    {
      return Math.max( 0, Math.min( MAX_Y, this.projectToUnclampedStackY( zp, yp, xp ) ) );
    };


    /**
     * Stack z-coordinate from project coordinates. In stack space, Z is
     * discrete and by convention, coordinates between one section and the next
     * are projected onto the first.
     */
    var projectToStackZ;
    switch ( orientation )
    {
    case Stack.ORIENTATION_XZ:
      projectToStackZ = function( zp, yp, xp )
      {
        return Math.floor( ( yp - translation.y ) / resolution.z );
      };
      break;
    case Stack.ORIENTATION_ZY:
      projectToStackZ = function( zp, yp, xp )
      {
        return Math.floor( ( xp - translation.x ) / resolution.z );
      };
      break;
    default:
      projectToStackZ = function( zp, yp, xp )
      {
        return Math.floor( ( zp - translation.z ) / resolution.z );
      };
    }

    this.projectToLinearStackZ = projectToStackZ;


    /**
     * Stack z-coordinate from project coordinates, without clamping to the
     * stack bounds.
     */
    this.projectToUnclampedStackZ = function( zp, yp, xp )
    {
      var z1, z2;
      z1 = z2 = projectToStackZ( zp, yp, xp );
      while ( skip_planes[ z1 ] && skip_planes[ z2 ] )
      {
        z1 = Math.max( 0, z1 - 1 );
        z2 = Math.min( MAX_Z, z2 + 1 );
      }
      return skip_planes[ z1 ] ? z2 : z1;
    };

    /**
     * Stack y-coordinate from project coordinates, clamped to the stack
     * bounds.
     */
    this.projectToStackZ = function( zp, yp, xp )
    {
      return Math.max( 0, Math.min( MAX_Z, this.projectToUnclampedStackZ( zp, yp, xp ) ) );
    };

    /**
     * Project minimum planar resolution for a given zoom level.
     */
    this.stackToProjectSMP = function (s) {
      return this.minPlanarRes * Math.pow(2, s);
    };

    /**
     * Stack zoom level for a given minimum planar resolution.
     */
    this.projectToStackSMP = function (res) {
      return Math.log(res / this.minPlanarRes) / Math.LN2;
    };

    /**
     * Project x-coordinate resolution for a given zoom level.
     */
    this.stackToProjectSX = function (s) {
      return this.resolution.x * Math.pow(2, s);
    };

    /**
     * Stack zoom level for a given x-coordinate resolution.
     */
    this.projectToStackSX = function (res) {
      return Math.log(res / this.resolution.x) / Math.LN2;
    };

    /**
     * Project y-coordinate resolution for a given zoom level.
     */
    this.stackToProjectSY = function (s) {
      return this.resolution.y * Math.pow(2, s);
    };

    /**
     * Stack zoom level for a given y-coordinate resolution.
     */
    this.projectToStackSY = function (res) {
      return Math.log(res / this.resolution.y) / Math.LN2;
    };

    /**
     * Convert a project coordinate object with keys x, y, z to a stack
     * coordinate object. If a second argument is passed in, assign to it
     * rather than creating a new object.
     *
     * @param  {Object}  s An object in project coordinates.
     * @param  {Object=} p (optional) An object to be assigned stack
     *                     coordinates.
     * @return {Object}    The project coordinates transformed to stack
     *                     coordinates.
     */
    this.projectToStack = function (p, s) {
      s = s || {};

      s.x = this.projectToStackX(p.z, p.y, p.x);
      s.y = this.projectToStackY(p.z, p.y, p.x);
      s.z = this.projectToStackZ(p.z, p.y, p.x);

      return s;
    };

    /**
     * Convert a project coordinate object with keys x, y, z to a unclamped
     * stack coordinate object. If a second argument is passed in, assign to it
     * rather than creating a new object.
     *
     * @param  {Object}  s An object in project coordinates.
     * @param  {Object=} p (optional) An object to be assigned unclamped stack
     *                     coordinates.
     * @return {Object}    The project coordinates transformed to unclamped
     *                     stack coordinates.
     */
    this.projectToUnclampedStack = function (p, s) {
      s = s || {};

      s.x = this.projectToUnclampedStackX(p.z, p.y, p.x);
      s.y = this.projectToUnclampedStackY(p.z, p.y, p.x);
      s.z = this.projectToUnclampedStackZ(p.z, p.y, p.x);

      return s;
    };

    /**
     * Convert a stack coordinate object with keys x, y, z to a project
     * coordinate object. If a second argument is passed in, assign to it
     * rather than creating a new object.
     *
     * @param  {Object}  s An object in stack coordinates.
     * @param  {Object=} p (optional) An object to be assigned project
     *                     coordinates.
     * @return {Object}    The stack coordinates transformed to project
     *                     coordinates.
     */
    this.stackToProject = function (s, p) {
      p = p || {};

      p.x = this.stackToProjectX(s.z, s.y, s.x);
      p.y = this.stackToProjectY(s.z, s.y, s.x);
      p.z = this.stackToProjectZ(s.z, s.y, s.x);

      return p;
    };

    /**
     * Transfer the limiting coordinates of an orthogonal box from stack to
     * project coordinates.  Transferred coordinates are written into
     * projectBox.  This method is faster than createStackToProjectBox because
     * it does not generate new objects (Firefox 20%, Chromium 100% !)
     *
     *  @param stackBox   {{min: {x, y, z}, max: {x, y, z}}}
     *  @param projectBox {{min: {x, y, z}, max: {x, y, z}}}
     */
    this.stackToProjectBox = function( stackBox, projectBox )
    {
      this.stackToProject(stackBox.min, projectBox.min);
      this.stackToProject(stackBox.max, projectBox.max);

      return projectBox;
    };


    /**
     * Create a new box from an orthogonal box by transferring its limiting
     * coordinates from stack to project coordinates.
     *
     *  @param stackBox {{min: {x, y, z}, max: {x, y, z}}}
     */
    this.createStackToProjectBox = function( stackBox )
    {
      return this.stackToProjectBox(stackBox, {min: {}, max: {}});
    };

    /**
     * Create a new stack box representing the extents of the stack.
     * @return {{min: {x, y, z}, max: {x, y, z}}} extents of the stack in stack coordinates
     */
    this.createStackExtentsBox = function () {
      return {
        min: {x:     0, y:     0, z:     0},
        max: {x: MAX_X, y: MAX_Y, z: MAX_Z}
      };
    };

    /**
     * Get a mapping of stack space X and Y dimensions to project space
     * dimensions.
     */
    switch ( orientation )
    {
      case CATMAID.Stack.ORIENTATION_XZ:
        this.getPlaneDimensions = function() {
          return {x: 'x', y: 'z'};
        };
        break;
      case CATMAID.Stack.ORIENTATION_ZY:
        this.getPlaneDimensions = function() {
          return {x: 'z', y: 'y'};
        };
        break;
      default:
        this.getPlaneDimensions = function() {
          return {x: 'x', y: 'y'};
        };
        break;
    }

    /**
     * Get the project space dimension of the normal direction relative to this
     * stack's plane.
     */
    switch ( orientation )
    {
      case CATMAID.Stack.ORIENTATION_XZ:
        this.getNormalDimension = function() {
          return 'y';
        };
        break;
      case CATMAID.Stack.ORIENTATION_ZY:
        this.getNormalDimension = function() {
          return 'x';
        };
        break;
      default:
        this.getNormalDimension = function() {
          return 'z';
        };
        break;
    }

    /**
     * Return whether a given section number is marked as broken.
     *
     * @param  {Number}  section Stack z coordinate of the section to check
     * @return {Boolean}         True if the section is marked as broken.
     */
    self.isSliceBroken = function (section) {
      return -1 !== self.broken_slices.indexOf(section);
    };

    /**
     * Return the distance to the closest valid section number before the
     * given one. Or null if there is none.
     */
    self.validZDistanceBefore = function(section) {
      return self.validZDistanceByStep(section, -1);
    };

    /**
     * Return the distance to the closest valid section after the given one.
     * Or null if there is none.
     */
    self.validZDistanceAfter = function (section) {
      return self.validZDistanceByStep(section, 1);
    };

    /**
     * Return the distance to the closest valid section relative to the given
     * one in strided steps.
     */
    self.validZDistanceByStep = function (section, step) {
      var adj = section;
      while (true) {
        adj = adj + step;
        if (adj > self.MAX_Z || adj < 0) return null;
        if (!self.isSliceBroken(adj)) return adj - section;
      }
    };

    self.createTileSourceForMirror = function (mirrorIdx) {
      var mirror = self.mirrors[mirrorIdx];
      if (!mirror) {
        throw new CATMAID.ValueError("No mirror with index " + mirrorIdx + " available");
      }
      var selectedMirror = mirror;

      return CATMAID.getTileSource(
          selectedMirror.tile_source_type,
          selectedMirror.image_base,
          selectedMirror.file_extension,
          selectedMirror.tile_width,
          selectedMirror.tile_height);
    };

    self.addMirror = function(mirrorData) {
      self.mirrors.push({
          id: mirrorData.id,
          image_base: mirrorData.image_base,
          file_extension: mirrorData.file_extension,
          tile_source_type: mirrorData.tile_source_type,
          tile_width: mirrorData.tile_width,
          tile_height: mirrorData.tile_height,
          title: mirrorData.title
      });
      return self.mirrors.length - 1;
    };

    self.removeMirror = function(mirrorIndex) {
      self.mirrors.splice(mirrorIndex, 1);
    };
  }

  /**
   * Get all available stacks for a given project, optionally sorted by name.
   */
  Stack.list = function(projectId, sort) {
    var stacks = CATMAID.fetch(projectId + '/stacks');
    if (sort) {
      stacks = stacks.then(function(stacks) {
        return stacks.sort(function(a, b) {
          return CATMAID.tools.compareStrings(a.title, b.title);
        });
      });
    }

    return stacks;
  };

  CATMAID.Stack = Stack;

})(CATMAID);
