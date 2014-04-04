(function(){

angular.module('ui.grid')
.factory('Grid', ['$log', '$q', '$parse', 'gridUtil', 'uiGridConstants', 'GridOptions', 'GridColumn', 'GridRow', 'columnSorter', function($log, $q, $parse, gridUtil, uiGridConstants, GridOptions, GridColumn, GridRow, columnSorter) {

/**
   * @ngdoc function
   * @name ui.grid.class:Grid
   * @description Grid defines a logical grid.  Any non-dom properties and elements needed by the grid should
   *              be defined in this class
   * @param {string} id id to assign to grid
   */
  var Grid = function (id) {
    this.id = id;
    this.options = new GridOptions();
    this.headerHeight = this.options.headerRowHeight;
    this.gridHeight = 0;
    this.gridWidth = 0;
    this.columnBuilders = [];
    this.rowBuilders = [];
    this.rowsProcessors = [];
    this.styleComputations = [];
    this.visibleRowCache = [];

    this.cellValueGetterCache = {};

    // Validate options
    if (!this.options.enableNativeScrolling && !this.options.enableVirtualScrolling) {
      throw "Either native or virtual scrolling must be enabled.";
    }


    //representation of the rows on the grid.
    //these are wrapped references to the actual data rows (options.data)
    this.rows = [];

    //represents the columns on the grid
    this.columns = [];

    //current rows that are rendered on the DOM
    this.renderedRows = [];
    this.renderedColumns = [];
  };

  /**
   * @ngdoc function
   * @name registerColumnBuilder
   * @methodOf ui.grid.class:Grid
   * @description When the build creates columns from column definitions, the columnbuilders will be called to add
   * additional properties to the column.
   * @param {function(colDef, col, gridOptions)} columnsProcessor function to be called
   */
  Grid.prototype.registerColumnBuilder = function (columnsProcessor) {
    this.columnBuilders.push(columnsProcessor);
  };

  /**
   * @ngdoc function
   * @name registerRowBuilder
   * @methodOf ui.grid.class:Grid
   * @description When the build creates rows from gridOptions.data, the rowBuilders will be called to add
   * additional properties to the row.
   * @param {function(colDef, col, gridOptions)} columnsProcessor function to be called
   */
  Grid.prototype.registerRowBuilder = function (rowBuilder) {
    this.rowBuilders.push(rowBuilder);
  };

  /**
   * @ngdoc function
   * @name getColumn
   * @methodOf ui.grid.class:Grid
   * @description returns a grid column for the column name
   * @param {string} name column name
   */
  Grid.prototype.getColumn = function (name) {
    var columns = this.columns.filter(function (column) {
      return column.colDef.name === name;
    });
    return columns.length > 0 ? columns[0] : null;
  };

  /**
   * @ngdoc function
   * @name buildColumns
   * @methodOf ui.grid.class:Grid
   * @description creates GridColumn objects from the columnDefinition.  Calls each registered
   * columnBuilder to further process the column
   * @returns {Promise} a promise to load any needed column resources
   */
  Grid.prototype.buildColumns = function () {
    $log.debug('buildColumns');
    var self = this;
    var builderPromises = [];

    self.options.columnDefs.forEach(function (colDef, index) {
      self.preprocessColDef(colDef);
      var col = self.getColumn(colDef.name);

      if (!col) {
        col = new GridColumn(colDef, index);
        self.columns.push(col);
      }
      else {
        col.updateColumnDef(colDef, col.index);
      }

      self.columnBuilders.forEach(function (builder) {
        builderPromises.push(builder.call(self, colDef, col, self.options));
      });

    });

    return $q.all(builderPromises);
  };

  /**
   * undocumented function
   * @name preprocessColDef
   * @methodOf ui.grid.class:Grid
   * @description defaults the name property from field to maintain backwards compatibility with 2.x
   * validates that name or field is present
   */
  Grid.prototype.preprocessColDef = function (colDef) {
    if (!colDef.field && !colDef.name) {
      throw new Error('colDef.name or colDef.field property is required');
    }

    //maintain backwards compatibility with 2.x
    //field was required in 2.x.  now name is required
    if (colDef.name === undefined && colDef.field !== undefined) {
      colDef.name = colDef.field;
    }
  };

  /**
   * @ngdoc function
   * @name modifyRows
   * @methodOf ui.grid.class:Grid
   * @description creates or removes GridRow objects from the newRawData array.  Calls each registered
   * rowBuilder to further process the row
   *
   * Rows are identified using the gridOptions.rowEquality function
   */
  Grid.prototype.modifyRows = function(newRawData) {
    var self = this;

    if (self.rows.length === 0 && newRawData.length > 0) {
      self.addRows(newRawData);
    }
    else {
      //look for new rows
      var newRows = newRawData.filter(function (newItem) {
        return !self.rows.some(function(oldRow) {
          return self.options.rowEquality(oldRow.entity, newItem);
        });
      });

      for (i = 0; i < newRows.length; i++) {
        self.addRows([newRows[i]]);
      }

      //look for deleted rows
      var deletedRows = self.rows.filter(function (oldRow) {
        return !newRawData.some(function (newItem) {
          return self.options.rowEquality(newItem, oldRow.entity);
        });
      });

      for (var i = 0; i < deletedRows.length; i++) {
        self.rows.splice( self.rows.indexOf(deletedRows[i] ), 1 );
      }
    }

    var renderableRows = self.processRowsProcessors(self.rows);

    self.setVisibleRows(renderableRows);
  };

  /**
   * Private Undocumented Method
   * @name addRows
   * @methodOf ui.grid.class:Grid
   * @description adds the newRawData array of rows to the grid and calls all registered
   * rowBuilders. this keyword will reference the grid
   */
  Grid.prototype.addRows = function(newRawData) {
    var self = this;

    for (var i=0; i < newRawData.length; i++) {
      self.rows.push( self.processRowBuilders(new GridRow(newRawData[i], i)) );
    }
  };

  /**
   * @ngdoc function
   * @name processRowBuilders
   * @methodOf ui.grid.class:Grid
   * @description processes all RowBuilders for the gridRow
   * @param {GridRow} gridRow reference to gridRow
   * @returns {GridRow} the gridRow with all additional behavior added
   */
  Grid.prototype.processRowBuilders = function(gridRow) {
    var self = this;

    self.rowBuilders.forEach(function (builder) {
      builder.call(self, gridRow, self.gridOptions);
    });

    return gridRow;
  };

  /**
   * @ngdoc function
   * @name registerStyleComputation
   * @methodOf ui.grid.class:Grid
   * @description registered a styleComputation function
   * @param {function($scope)} styleComputation function
   */
  Grid.prototype.registerStyleComputation = function (styleComputationInfo) {
    this.styleComputations.push(styleComputationInfo);
  };


  // NOTE (c0bra): We already have rowBuilders. I think these do exactly the same thing...
  // Grid.prototype.registerRowFilter = function(filter) {
  //   // TODO(c0bra): validate filter?

  //   this.rowFilters.push(filter);
  // };

  // Grid.prototype.removeRowFilter = function(filter) {
  //   var idx = this.rowFilters.indexOf(filter);

  //   if (typeof(idx) !== 'undefined' && idx !== undefined) {
  //     this.rowFilters.slice(idx, 1);
  //   }
  // };
  
  // Grid.prototype.processRowFilters = function(rows) {
  //   var self = this;
  //   self.rowFilters.forEach(function (filter) {
  //     filter.call(self, rows);
  //   });
  // };


  /**
   * @ngdoc function
   * @name registerRowsProcessor
   * @methodOf ui.grid.class:Grid
   * @param {function(renderableRows)} rows processor function
   * @returns {Array[GridRow]} Updated renderable rows
   * @description

     Register a "rows processor" function. When the rows are updated,
     the grid calls eached registered "rows processor", which has a chance
     to alter the set of rows (sorting, etc) as long as the count is not
     modified.
   */
  Grid.prototype.registerRowsProcessor = function(processor) {
    this.rowsProcessors.push(processor);
  };

  /**
   * @ngdoc function
   * @name removeRowsProcessor
   * @methodOf ui.grid.class:Grid
   * @param {function(renderableRows)} rows processor function
   * @description Remove a registered rows processor
   */
  Grid.prototype.removeRowsProcessor = function(processor) {
    var idx = this.rowsProcessors.indexOf(processor);

    if (typeof(idx) !== 'undefined' && idx !== undefined) {
      this.rowsProcessors.slice(idx, 1);
    }
  };
  
  /**
   * Private Undocumented Method
   * @name processRowsProcessors
   * @methodOf ui.grid.class:Grid
   * @param {Array[GridRow]} The array of "renderable" rows
   * @param {Array[GridColumn]} The array of columns
   * @description Run all the registered rows processors on the array of renderable rows
   */
  Grid.prototype.processRowsProcessors = function(renderableRows) {
    var self = this;

    var i = 0;
    var newRenderableRows;
    self.rowsProcessors.forEach(function (processor) {
      newRenderableRows = processor.call(self, renderableRows, self.columns);

      if (! renderableRows) {
        throw "Processor at index " + i + " did not return a set of renderable rows";
      }

      if (!angular.isArray(renderableRows)) {
        throw "Processor at index " + i + " did not return an array";
      }

      i++;
    });

    return newRenderableRows;
  };

  Grid.prototype.setVisibleRows = function(rows) {
    var newVisibleRowCache = [];
    
    rows.forEach(function (row) {
      if (row.visible) {
        newVisibleRowCache.push(row);
      }
    });

    this.visibleRowCache = newVisibleRowCache;
  };


  Grid.prototype.setRenderedRows = function (newRows) {
    this.renderedRows.length = newRows.length;
    for (var i = 0; i < newRows.length; i++) {
      this.renderedRows[i] = newRows[i];
    }
  };

  Grid.prototype.setRenderedColumns = function (newColumns) {
    this.renderedColumns.length = newColumns.length;
    for (var i = 0; i < newColumns.length; i++) {
      this.renderedColumns[i] = newColumns[i];
    }
  };

  /**
   * @ngdoc function
   * @name buildStyles
   * @methodOf ui.grid.class:Grid
   * @description calls each styleComputation function
   */
  Grid.prototype.buildStyles = function ($scope) {
    var self = this;
    self.styleComputations
      .sort(function(a, b) {
        if (a.priority === null) { return 1; }
        if (b.priority === null) { return -1; }
        if (a.priority === null && b.priority === null) { return 0; }
        return a.priority - b.priority;
      })
      .forEach(function (compInfo) {
        compInfo.func.call(self, $scope);
      });
  };

  Grid.prototype.minRowsToRender = function () {
    return Math.ceil(this.getViewportHeight() / this.options.rowHeight);
  };

  Grid.prototype.minColumnsToRender = function () {
    var self = this;
    var viewport = this.getViewportWidth();

    var min = 0;
    var totalWidth = 0;
    self.columns.forEach(function(col, i) {
      if (totalWidth < viewport) {
        totalWidth += col.drawnWidth;
        min++;
      }
      else {
        var currWidth = 0;
        for (var j = i; j >= i - min; j--) {
          currWidth += self.columns[j].drawnWidth;
        }
        if (currWidth < viewport) {
          min++;
        }
      }
    });

    return min;
  };

  Grid.prototype.getBodyHeight = function () {
    // Start with the viewportHeight
    var bodyHeight = this.getViewportHeight();

    // Add the horizontal scrollbar height if there is one
    if (typeof(this.horizontalScrollbarHeight) !== 'undefined' && this.horizontalScrollbarHeight !== undefined && this.horizontalScrollbarHeight > 0) {
      bodyHeight = bodyHeight + this.horizontalScrollbarHeight;
    }

    return bodyHeight;
  };

  // NOTE: viewport drawable height is the height of the grid minus the header row height (including any border)
  // TODO(c0bra): account for footer height
  Grid.prototype.getViewportHeight = function () {
    var viewPortHeight = this.gridHeight - this.headerHeight;

    // Account for native horizontal scrollbar, if present
    if (typeof(this.horizontalScrollbarHeight) !== 'undefined' && this.horizontalScrollbarHeight !== undefined && this.horizontalScrollbarHeight > 0) {
      viewPortHeight = viewPortHeight - this.horizontalScrollbarHeight;
    }

    return viewPortHeight;
  };

  Grid.prototype.getViewportWidth = function () {
    var viewPortWidth = this.gridWidth;

    if (typeof(this.verticalScrollbarWidth) !== 'undefined' && this.verticalScrollbarWidth !== undefined && this.verticalScrollbarWidth > 0) {
      viewPortWidth = viewPortWidth - this.verticalScrollbarWidth;
    }

    return viewPortWidth;
  };

  Grid.prototype.getHeaderViewportWidth = function () {
    var viewPortWidth = this.getViewportWidth();

    if (typeof(this.verticalScrollbarWidth) !== 'undefined' && this.verticalScrollbarWidth !== undefined && this.verticalScrollbarWidth > 0) {
      viewPortWidth = viewPortWidth + this.verticalScrollbarWidth;
    }

    return viewPortWidth;
  };

  Grid.prototype.getCanvasHeight = function () {
    var ret =  this.options.rowHeight * this.rows.length;

    if (typeof(this.horizontalScrollbarHeight) !== 'undefined' && this.horizontalScrollbarHeight !== undefined && this.horizontalScrollbarHeight > 0) {
      ret = ret - this.horizontalScrollbarHeight;
    }

    return ret;
  };

  Grid.prototype.getCanvasWidth = function () {
    var ret = this.canvasWidth;

    if (typeof(this.verticalScrollbarWidth) !== 'undefined' && this.verticalScrollbarWidth !== undefined && this.verticalScrollbarWidth > 0) {
      ret = ret - this.verticalScrollbarWidth;
    }

    return ret;
  };

  Grid.prototype.getTotalRowHeight = function () {
    return this.options.rowHeight * this.rows.length;
  };

  // Is the grid currently scrolling?
  Grid.prototype.isScrolling = function() {
    return this.scrolling ? true : false;
  };

  Grid.prototype.setScrolling = function(scrolling) {
    this.scrolling = scrolling;
  };

  Grid.prototype.rowSearcher = function rowSearcher(rows) {
    var grid = this;
  };

  Grid.prototype.sortByColumn = function sortByColumn(renderableRows) {
    return columnSorter.sort(this, renderableRows, this.columns);
  };

  Grid.prototype.getCellValue = function getCellValue(row, col){
    var self = this;

    if (! self.cellValueGetterCache[col.colDef.name]) {
      self.cellValueGetterCache[col.colDef.name] = $parse(row.getEntityQualifiedColField(col));
    }

    return self.cellValueGetterCache[col.colDef.name](row);
  };

  // Reset all sorting on the grid
  Grid.prototype.getNextColumnPriority = function () {
    var self = this,
        p = 0;

    self.columns.forEach(function (col) {
      if (col.sort && col.sort.priority && col.sort.priority > p) {
        p = col.sort.priority;
      }
    });

    return p + 1;
  };

  Grid.prototype.resetColumnSortPriorities = function(excludeCol) {
    var self = this;

    self.columns.forEach(function (col) {
      if (col !== excludeCol) {
        col.sort = {};
      }
    });
  };

  Grid.prototype.sortColumn = function (column, directionOrAdd, add) {
    var self = this,
        direction = null;

    // Second argument can either be a direction or whether to add this column to the existing sort.
    //   If it's a boolean, it's an add, otherwise, it's a direction
    if (typeof(directionOrAdd) === 'boolean') {
      add = directionOrAdd;
    }
    
    if (!add) {
      self.resetColumnSortPriorities(column);
      column.sort.priority = 0;
    }
    else {
      column.sort.priority = self.getNextColumnPriority();
    }

    if (!direction) {
      // Figure out the sort direction
      if (column.sort.direction && column.sort.direction === uiGridConstants.ASC) {
        column.sort.direction = uiGridConstants.DESC;
      }
      else if (column.sort.direction && column.sort.direction === uiGridConstants.DESC) {
        column.sort.direction = null;
      }
      else {
        column.sort.direction = uiGridConstants.ASC;
      }
    }
    else {
      column.sort.direction = direction;
    }

    return $q.when(column);
  };

  return Grid;

}]);

})();