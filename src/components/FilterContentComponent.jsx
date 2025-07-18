import React, { useState, useMemo, useCallback, useRef } from 'react';
import { ChevronDown, ChevronRight, Download, FileText, Loader2, Upload, Search, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import iPrepLogo from '../assets/iPrep-logo.svg';

const FilterContentComponent = () => {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState({});
  const [expandedNodes, setExpandedNodes] = useState({});
  const [hasChanges, setHasChanges] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(false);
  const [fileUploaded, setFileUploaded] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [processingProgress, setProcessingProgress] = useState(0);
  const [loadingStage, setLoadingStage] = useState('');
  
  const abortControllerRef = useRef(null);

  // Optimized data processing with progress tracking, deduplication, and empty cell preservation
  const processExcelData = useCallback(async (workbook) => {
    const processedData = {};
    const initialSelection = {};
    const initialExpanded = {};
    const totalSheets = workbook.SheetNames.length;
    
    // Track unique combinations to prevent duplicates
    const uniqueTracker = new Set();
    
    for (let sheetIndex = 0; sheetIndex < totalSheets; sheetIndex++) {
      const sheetName = workbook.SheetNames[sheetIndex];
      setLoadingStage(`Processing sheet: ${sheetName}`);
      setProcessingProgress(((sheetIndex + 1) / totalSheets) * 100);
      
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, {
        defval: '', // Use empty string as default value for empty cells
        raw: false, // Keep original formatting
        dateNF: 'yyyy-mm-dd' // Standard date format
      });
      
      if (jsonData.length > 0) {
        processedData[sheetName] = new Map();
        initialSelection[sheetName] = { checked: true, indeterminate: false };
        initialExpanded[sheetName] = false; // Start collapsed for performance
        
        // Process data in chunks to avoid blocking
        const chunkSize = 100;
        for (let i = 0; i < jsonData.length; i += chunkSize) {
          const chunk = jsonData.slice(i, i + chunkSize);
          
          // Process chunk
          chunk.forEach((row, index) => {
            // Preserve all original data including empty cells
            const originalRow = { ...row };
            
            // Handle hierarchical organization fields - use placeholders for empty values
            const className = row.class !== undefined && row.class !== null && String(row.class).trim() 
              ? String(row.class).trim() 
              : `Unknown Class ${i + index + 1}`;
            
            const subjectName = row.subject_name !== undefined && row.subject_name !== null && String(row.subject_name).trim()
              ? String(row.subject_name).trim()
              : `Unknown Subject ${i + index + 1}`;
            
            const chapterName = row.chapter_name !== undefined && row.chapter_name !== null && String(row.chapter_name).trim()
              ? String(row.chapter_name).trim()
              : `Unknown Chapter ${i + index + 1}`;
            
            const topicName = row.topic_name !== undefined && row.topic_name !== null && String(row.topic_name).trim()
              ? String(row.topic_name).trim()
              : `Unknown Topic ${i + index + 1}`;
            
            // Create unique identifier for this combination
            const uniqueId = `${sheetName}|${className}|${subjectName}|${chapterName}|${topicName}|${i + index}`;
            
            const classKey = `${sheetName}-${className}`;
            const subjectKey = `${classKey}-${subjectName}`;
            const chapterKey = `${subjectKey}-${chapterName}`;
            const topicKey = `${chapterKey}-${topicName}`;

            // Initialize nested structure with Maps for better performance
            if (!processedData[sheetName].has(className)) {
              processedData[sheetName].set(className, new Map());
              initialSelection[classKey] = { checked: true, indeterminate: false };
              initialExpanded[classKey] = false;
            }

            const classData = processedData[sheetName].get(className);
            if (!classData.has(subjectName)) {
              classData.set(subjectName, new Map());
              initialSelection[subjectKey] = { checked: true, indeterminate: false };
              initialExpanded[subjectKey] = false;
            }

            const subjectData = classData.get(subjectName);
            if (!subjectData.has(chapterName)) {
              subjectData.set(chapterName, new Map());
              initialSelection[chapterKey] = { checked: true, indeterminate: false };
              initialExpanded[chapterKey] = false;
            }

            const chapterData = subjectData.get(chapterName);
            if (!chapterData.has(topicName)) {
              chapterData.set(topicName, []);
              initialSelection[topicKey] = { checked: true, indeterminate: false };
            }

            // Always add the original row data (including empty cells) if not duplicate
            if (!uniqueTracker.has(uniqueId)) {
              uniqueTracker.add(uniqueId);
              // Store original row data with preserved empty cells
              chapterData.get(topicName).push(originalRow);
            }
          });
          
          // Allow UI to update between chunks
          if (i % (chunkSize * 5) === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
      }
    }
    
    // Don't clean up empty entries - preserve the structure as-is
    return { processedData, initialSelection, initialExpanded };
  }, []);

  // Handle file upload with progress
  const handleFileUpload = useCallback(async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setLoading(true);
    setProcessingProgress(0);
    setLoadingStage('Reading file...');
    
    abortControllerRef.current = new AbortController();
    
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const data = e.target.result;
        setLoadingStage('Parsing Excel file...');
        
        const workbook = XLSX.read(data, {
          type: 'binary',
          cellStyles: false, // Disable for performance
          cellFormulas: false,
          cellDates: true,
          cellNF: false,
          sheetStubs: true, // Include empty cells
          defval: '', // Default value for empty cells
          raw: false // Keep original formatting
        });

        const { processedData, initialSelection, initialExpanded } = await processExcelData(workbook);
        
        setData(processedData);
        setSelection(initialSelection);
        setExpandedNodes(initialExpanded);
        setFileUploaded(true);
        setLoading(false);
        setProcessingProgress(100);
        setLoadingStage('Complete!');
      } catch (error) {
        console.error('Error processing file:', error);
        setLoading(false);
        alert('Error processing file. Please make sure it\'s a valid Excel file.');
      }
    };

    reader.readAsBinaryString(file);
  }, [processExcelData]);

  // Optimized selection update with debouncing
  const updateSelection = useCallback((nodeKey, checked) => {
    setSelection(prev => {
      const newSelection = { ...prev };
      newSelection[nodeKey] = { checked, indeterminate: false };
      
      // Update children efficiently
      const updateChildren = (key, state) => {
        const keyPrefix = key + '-';
        Object.keys(newSelection).forEach(selKey => {
          if (selKey.startsWith(keyPrefix) && selKey !== key) {
            newSelection[selKey] = { checked: state, indeterminate: false };
          }
        });
      };
      
      updateChildren(nodeKey, checked);
      
      // Update parent states
      const updateParent = (key) => {
        const parts = key.split('-');
        if (parts.length > 1) {
          const parentKey = parts.slice(0, -1).join('-');
          const siblings = Object.keys(newSelection).filter(k => 
            k.startsWith(parentKey + '-') && k.split('-').length === parts.length
          );
          
          const checkedSiblings = siblings.filter(k => newSelection[k]?.checked);
          const indeterminateSiblings = siblings.filter(k => newSelection[k]?.indeterminate);
          
          if (checkedSiblings.length === siblings.length) {
            newSelection[parentKey] = { checked: true, indeterminate: false };
          } else if (checkedSiblings.length > 0 || indeterminateSiblings.length > 0) {
            newSelection[parentKey] = { checked: false, indeterminate: true };
          } else {
            newSelection[parentKey] = { checked: false, indeterminate: false };
          }
          
          updateParent(parentKey);
        }
      };
      
      updateParent(nodeKey);
      
      return newSelection;
    });
    
    setHasChanges(true);
  }, []);

  // Toggle node expansion
  const toggleExpanded = useCallback((nodeKey) => {
    setExpandedNodes(prev => ({
      ...prev,
      [nodeKey]: !prev[nodeKey]
    }));
  }, []);

  // Helper function to safely convert to string and search, handling empty cells
  const safeSearch = (value, searchTerm) => {
    if (!searchTerm) return false;
    if (value === '' || value === null || value === undefined) return false;
    return String(value).toLowerCase().includes(searchTerm.toLowerCase());
  };

  // Helper function to display labels with empty value handling
  const getDisplayLabel = (value, type) => {
    if (value === '' || value === null || value === undefined) {
      return `[Empty ${type}]`;
    }
    return String(value);
  };

  // Memoized filtered data
  const filteredData = useMemo(() => {
    if (!searchTerm) return data;
    
    const filtered = {};
    Object.keys(data).forEach(category => {
      if (safeSearch(category, searchTerm)) {
        filtered[category] = data[category];
        return;
      }
      
      const filteredCategory = new Map();
      data[category].forEach((classes, className) => {
        if (safeSearch(className, searchTerm)) {
          filteredCategory.set(className, classes);
          return;
        }
        
        const filteredClasses = new Map();
        classes.forEach((subjects, subjectName) => {
          if (safeSearch(subjectName, searchTerm)) {
            filteredClasses.set(subjectName, subjects);
            return;
          }
          
          const filteredSubjects = new Map();
          subjects.forEach((chapters, chapterName) => {
            if (safeSearch(chapterName, searchTerm)) {
              filteredSubjects.set(chapterName, chapters);
              return;
            }
            
            const filteredChapters = new Map();
            chapters.forEach((topics, topicName) => {
              if (safeSearch(topicName, searchTerm)) {
                filteredChapters.set(topicName, topics);
              }
            });
            
            if (filteredChapters.size > 0) {
              filteredSubjects.set(chapterName, filteredChapters);
            }
          });
          
          if (filteredSubjects.size > 0) {
            filteredClasses.set(subjectName, filteredSubjects);
          }
        });
        
        if (filteredClasses.size > 0) {
          filteredCategory.set(className, filteredClasses);
        }
      });
      
      if (filteredCategory.size > 0) {
        filtered[category] = filteredCategory;
      }
    });
    
    return filtered;
  }, [data, searchTerm]);

  // Optimized data extraction for download
  const getFilteredData = useCallback(() => {
    const result = {};
    
    Object.keys(data).forEach(category => {
      if (selection[category]?.checked || selection[category]?.indeterminate) {
        result[category] = [];
        
        data[category].forEach((classes, className) => {
          const classKey = `${category}-${className}`;
          if (selection[classKey]?.checked || selection[classKey]?.indeterminate) {
            
            classes.forEach((subjects, subjectName) => {
              const subjectKey = `${classKey}-${subjectName}`;
              if (selection[subjectKey]?.checked || selection[subjectKey]?.indeterminate) {
                
                subjects.forEach((chapters, chapterName) => {
                  const chapterKey = `${subjectKey}-${chapterName}`;
                  if (selection[chapterKey]?.checked || selection[chapterKey]?.indeterminate) {
                    
                    chapters.forEach((topics, topicName) => {
                      const topicKey = `${chapterKey}-${topicName}`;
                      if (selection[topicKey]?.checked) {
                        result[category].push(...topics);
                      }
                    });
                  }
                });
              }
            });
          }
        });
      }
    });
    
    return result;
  }, [data, selection]);

  // Download function with exact original data preservation and no trailing empty rows
  const downloadFilteredExcel = useCallback(async () => {
    setDownloadProgress(true);
    try {
      const filteredData = getFilteredData();
      const wb = XLSX.utils.book_new();
      
      // Process in chunks to avoid blocking
      const categories = Object.keys(filteredData);
      for (let i = 0; i < categories.length; i++) {
        const category = categories[i];
        if (filteredData[category].length > 0) {
          // Create worksheet with exact same settings as original data
          const ws = XLSX.utils.json_to_sheet(filteredData[category], {
            defval: '', // Preserve empty cells as empty strings
            skipHeader: false,
            dateNF: 'yyyy-mm-dd'
          });
          
          // Get the actual data range
          const range = XLSX.utils.decode_range(ws['!ref']);
          const actualDataRowCount = filteredData[category].length;
          
          // Ensure all columns are present for actual data rows only
          for (let row = range.s.r; row <= range.s.r + actualDataRowCount; row++) {
            for (let col = range.s.c; col <= range.e.c; col++) {
              const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
              if (!ws[cellAddress]) {
                // Only create empty cell if it's within the actual data range
                ws[cellAddress] = { t: 's', v: '' };
              }
            }
          }
          
          // Set the worksheet range to only include actual data (no trailing empty rows)
          const newRange = {
            s: { r: range.s.r, c: range.s.c },
            e: { r: range.s.r + actualDataRowCount, c: range.e.c }
          };
          ws['!ref'] = XLSX.utils.encode_range(newRange);
          
          // Remove any cells that are beyond the actual data range
          Object.keys(ws).forEach(cell => {
            if (cell.startsWith('!')) return; // Skip metadata
            const cellRef = XLSX.utils.decode_cell(cell);
            if (cellRef.r > range.s.r + actualDataRowCount) {
              delete ws[cell];
            }
          });
          
          XLSX.utils.book_append_sheet(wb, ws, category);
        }
        
        // Allow UI updates between sheets
        if (i % 3 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      
      // Write file with same format as original
      XLSX.writeFile(wb, `Filtered_Excel_File_${Date.now()}.xlsx`, {
        bookType: 'xlsx',
        cellDates: true,
        sheetStubs: true, // Include empty cells (but only within actual data range)
        compression: true // Enable compression but preserve data structure
      });
      setHasChanges(false);
    } catch (error) {
      console.error('Error downloading file:', error);
      alert('Error downloading file. Please try again.');
    } finally {
      setDownloadProgress(false);
    }
  }, [getFilteredData]);

  // Simplified checkbox component with better state management
  const CheckboxComponent = ({ nodeKey, label, hasChildren = false }) => {
    const state = selection[nodeKey] || { checked: false, indeterminate: false };
    
    const handleCheckboxChange = (e) => {
      e.stopPropagation();
      updateSelection(nodeKey, e.target.checked);
    };

    const handleToggleExpanded = (e) => {
      e.stopPropagation();
      toggleExpanded(nodeKey);
    };

    return (
      <div className="flex items-center space-x-2">
        <label className="flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={state.checked}
            onChange={handleCheckboxChange}
            ref={input => {
              if (input) {
                input.indeterminate = state.indeterminate;
              }
            }}
            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 cursor-pointer"
          />
          <span className="ml-2 text-sm font-medium text-gray-700 truncate select-none">
            {label}
          </span>
        </label>
        {hasChildren && (
          <button
            onClick={handleToggleExpanded}
            className="ml-1 text-gray-500 hover:text-gray-700 flex-shrink-0 p-1 hover:bg-gray-100 rounded"
            type="button"
          >
            {expandedNodes[nodeKey] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        )}
      </div>
    );
  };

  // Virtualized tree renderer with proper sorting and uniqueness
  const renderTree = useMemo(() => {
    return Object.keys(filteredData)
      .sort() // Sort categories alphabetically
      .map(category => {
        const categoryData = filteredData[category];
        const classCount = categoryData instanceof Map ? categoryData.size : Object.keys(categoryData).length;
        
        return (
          <div key={category} className="mb-3">
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
              <CheckboxComponent 
                nodeKey={category} 
                label={`${category} (${classCount} classes)`} 
                hasChildren={true} 
              />
            </div>
            
            {expandedNodes[category] && (
              <div className="ml-4 mt-2 space-y-2 max-h-60 overflow-y-auto">
                {categoryData instanceof Map ? 
                  Array.from(categoryData.entries())
                    .sort(([a], [b]) => {
                      // Sort classes numerically if they're numbers, otherwise alphabetically
                      const aNum = parseFloat(a);
                      const bNum = parseFloat(b);
                      if (!isNaN(aNum) && !isNaN(bNum)) {
                        return aNum - bNum;
                      }
                      return String(a).localeCompare(String(b));
                    })
                    .map(([className, classes]) => {
                      const classKey = `${category}-${className}`;
                      const subjectCount = classes.size;
                      
                      return (
                        <div key={classKey}>
                          <div className="p-2 bg-gray-100 rounded-lg border border-gray-200">
                            <CheckboxComponent 
                              nodeKey={classKey} 
                              label={`${getDisplayLabel(className, 'Class')} (${subjectCount} subjects)`} 
                              hasChildren={true} 
                            />
                          </div>
                          
                          {expandedNodes[classKey] && (
                            <div className="ml-4 mt-2 space-y-2 max-h-48 overflow-y-auto">
                              {Array.from(classes.entries())
                                .sort(([a], [b]) => String(a).localeCompare(String(b)))
                                                                                      .slice(0, 100)
                                .map(([subjectName, subjects]) => {
                                  const subjectKey = `${classKey}-${subjectName}`;
                                  const chapterCount = subjects.size;
                                  
                                  return (
                                    <div key={subjectKey}>
                                      <div className="p-2 bg-green-50 rounded-lg border border-green-200">
                                        <CheckboxComponent 
                                          nodeKey={subjectKey} 
                                          label={`${getDisplayLabel(subjectName, 'Subject')} (${chapterCount} chapters)`} 
                                          hasChildren={true} 
                                        />
                                      </div>
                                      
                                      {expandedNodes[subjectKey] && (
                                        <div className="ml-4 mt-2 space-y-2 max-h-40 overflow-y-auto">
                                          {Array.from(subjects.entries())
                                            .sort(([a], [b]) => String(a).localeCompare(String(b)))
                                            .slice(0, 30)
                                            .map(([chapterName, chapters]) => {
                                              const chapterKey = `${subjectKey}-${chapterName}`;
                                              const topicCount = chapters.size;
                                              
                                              return (
                                                <div key={chapterKey}>
                                                  <div className="p-2 bg-yellow-50 rounded-lg border border-yellow-200">
                                                    <CheckboxComponent 
                                                      nodeKey={chapterKey} 
                                                      label={`${getDisplayLabel(chapterName, 'Chapter')} (${topicCount} topics)`} 
                                                      hasChildren={true} 
                                                    />
                                                  </div>
                                                  
                                                  {expandedNodes[chapterKey] && (
                                                    <div className="ml-4 mt-2 space-y-1 max-h-32 overflow-y-auto">
                                                      {Array.from(chapters.entries())
                                                        .sort(([a], [b]) => String(a).localeCompare(String(b)))
                                                        .slice(0, 20)
                                                        .map(([topicName, topics]) => {
                                                          const topicKey = `${chapterKey}-${topicName}`;
                                                          const topicCount = topics.length;
                                                          
                                                          return (
                                                            <div key={topicKey} className="p-2 bg-purple-50 rounded-lg border border-purple-200">
                                                              <CheckboxComponent 
                                                                nodeKey={topicKey} 
                                                                label={`${topicName} (${topicCount} items)`} 
                                                              />
                                                            </div>
                                                          );
                                                        })}
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                            </div>
                          )}
                        </div>
                      );
                    }) :
                  Object.keys(categoryData)
                    .sort()
                    .slice(0, 200)
                    .map(className => {
                      // Handle non-Map format for backward compatibility
                      const classKey = `${category}-${className}`;
                      const subjectCount = Object.keys(categoryData[className]).length;
                      
                      return (
                        <div key={classKey}>
                          <div className="p-2 bg-gray-100 rounded-lg border border-gray-200">
                            <CheckboxComponent 
                              nodeKey={classKey} 
                              label={`${getDisplayLabel(className, 'Class')} (${subjectCount} subjects)`} 
                              hasChildren={true} 
                            />
                          </div>
                        </div>
                      );
                    })
                }
              </div>
            )}
          </div>
        );
      });
  }, [filteredData, expandedNodes, selection, updateSelection, toggleExpanded]);

  // File upload UI
  if (!fileUploaded) {
    return (
      <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg mt-8">
        <div className="text-center">
          <div className="flex justify-center items-center">
            <img src={iPrepLogo} alt="iDream Logo" className='max-w-48' />
          </div>
          <h1 className="text-4xl font-bold text-gray-800 mb-4">Content Selection Tool</h1>
          <p className="text-gray-600 mb-2">Upload your Excel file to get started</p>
          
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 hover:border-gray-400 transition-colors">
            <Upload className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <label className="cursor-pointer">
              <span className="text-blue-600 hover:text-blue-700 font-medium text-lg">
                Choose Excel file
              </span>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
            <p className="text-sm text-gray-500 mt-2">
              Supports .xlsx and .xls files
            </p>
          </div>
          
          {loading && (
            <div className="mt-6">
              <div className="flex items-center justify-center mb-4">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                <span className="ml-2 text-gray-600">{loadingStage}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${processingProgress}%` }}
                ></div>
              </div>
              <p className="text-sm text-gray-500 mt-2">{Math.round(processingProgress)}% complete</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Main UI after file upload
  return (
    <div className="max-w-7xl mx-auto p-6 bg-white rounded-lg shadow-lg mt-8">
      <div className="mb-6">
        <h1 className="text-4xl font-bold text-gray-800 mb-2">Content Selection Tool</h1>
        <p className="text-gray-600">Select the content you want to include in your filtered Excel file. All content is selected by default.</p>
      </div>

      {/* Search and controls */}
      <div className="mb-6 flex flex-wrap gap-4">
        <div className="flex-1 min-w-64">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search categories, classes, subjects, chapters, or topics..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-3 h-4 w-4 text-gray-400 hover:text-gray-600"
              >
                <X />
              </button>
            )}
          </div>
        </div>
        
        <button
          onClick={downloadFilteredExcel}
          disabled={!hasChanges || downloadProgress}
          className={`flex items-center px-6 py-3 rounded-lg font-medium transition-colors ${
            hasChanges && !downloadProgress
              ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          {downloadProgress ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Generating Excel...
            </>
          ) : (
            <>
              <Download className="w-5 h-5 mr-2" />
              Download Filtered Excel
            </>
          )}
        </button>
        
        <button
          onClick={() => {
            setData({});
            setSelection({});
            setExpandedNodes({});
            setHasChanges(false);
            setFileUploaded(false);
            setSearchTerm('');
          }}
          className="flex items-center px-6 py-3 rounded-lg font-medium bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
        >
          <Upload className="w-5 h-5 mr-2" />
          Upload New File
        </button>
      </div>
      
      {/* Tree view */}
      <div className="bg-gray-50 rounded-lg p-6 max-h-[800px] overflow-y-auto border border-gray-200">
        <div className="space-y-3">
          {renderTree}
        </div>
      </div>
      
      {/* Footer info */}
      <div className="mt-6 flex justify-between items-center text-sm text-gray-500">
        <div className="flex items-center">
          <FileText className="w-4 h-4 mr-1" />
          Total categories: {Object.keys(data).length}
        </div>
        <div className="flex items-center">
          Changes made: <span className={`ml-1 font-medium ${hasChanges ? 'text-green-600' : 'text-gray-500'}`}>
            {hasChanges ? 'Yes' : 'No'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default FilterContentComponent;