export interface FilteredText {
  drawingNumbers: string[];
  dates: string[];
  dimensions: string[];
  technicalSpecs: string[];
  japaneseText: string[];
  companyInfo: string[];
  materialInfo: string[];
  confidence: number;
  originalText: string;
}

export class TextFilter {
  
  /**
   * Extract drawing numbers from text with advanced context-aware matching
   */
  static extractDrawingNumbersWithContext(text: string): string[] {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const drawingNumbers = new Set<string>();
    
    console.log('🔍 Starting context-aware drawing number extraction...');
    
    // Method 1: Find "Drawing" and extract nearby text with fuzzy matching
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Fuzzy matching for "Drawing" - handles OCR errors
      const drawingPatterns = [
        /drawing/i,
        /drawin/i,    // missing 'g'
        /drawi/i,     // missing 'ng'
        /drawng/i,    // missing 'i'
        /dravving/i,  // OCR confusion v->w
        /drawimg/i,   // OCR confusion n->m  
        /dra\s*wi\s*ng/i, // spaces in between
        /d.*r.*a.*w.*i.*n.*g/i, // very fuzzy with any characters
        /図面/,       // Japanese
        /dwg/i        // Abbreviation
      ];
      
      const foundDrawing = drawingPatterns.some(pattern => pattern.test(line));
      
      if (foundDrawing) {
        console.log(`🎯 Found "Drawing" pattern in line: "${line}"`);
        
        // Check same line for numbers after "Drawing"
        const sameLineNumbers = this.extractNumbersFromDrawingLine(line);
        sameLineNumbers.forEach(num => {
          console.log(`📍 Found same-line number: ${num}`);
          drawingNumbers.add(num);
        });
        
        // Check next line (below) for drawing numbers - PRIORITY
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          console.log(`🔽 Checking below line: "${nextLine}"`);
          const belowNumbers = this.extractPotentialDrawingNumbers(nextLine);
          belowNumbers.forEach(num => {
            console.log(`📍 Found below-line number: ${num}`);
            drawingNumbers.add(num);
          });
        }
        
        // Check line after next (2 lines below)
        if (i + 2 < lines.length) {
          const secondNextLine = lines[i + 2];
          console.log(`🔽🔽 Checking 2-below line: "${secondNextLine}"`);
          const belowNumbers2 = this.extractPotentialDrawingNumbers(secondNextLine);
          belowNumbers2.forEach(num => {
            console.log(`📍 Found 2-below number: ${num}`);
            drawingNumbers.add(num);
          });
        }
        
        // Check right side of the same line (after Drawing)
        const rightSideText = line.substring(line.toLowerCase().indexOf('drawing') + 7);
        if (rightSideText.length > 2) {
          console.log(`➡️  Checking right side: "${rightSideText}"`);
          const rightNumbers = this.extractPotentialDrawingNumbers(rightSideText);
          rightNumbers.forEach(num => {
            console.log(`📍 Found right-side number: ${num}`);
            drawingNumbers.add(num);
          });
        }
      }
    }
    
    // Method 2: Look for drawing number patterns in context
    const contextNumbers = this.extractDrawingNumbersByContext(text);
    contextNumbers.forEach(num => drawingNumbers.add(num));
    
    return Array.from(drawingNumbers).filter(num => num.length >= 3);
  }
  
  private static extractNumbersFromDrawingLine(line: string): string[] {
    const numbers: string[] = [];
    
    // Extract numbers after Drawing/図面/DWG keywords
    const afterKeywordMatch = line.match(/(drawing|図面|dwg)\s*no?\.?\s*:?\s*([A-Z0-9\-_.]+)/gi);
    if (afterKeywordMatch) {
      afterKeywordMatch.forEach(match => {
        const number = match.replace(/(drawing|図面|dwg)\s*no?\.?\s*:?\s*/gi, '').trim();
        if (number.length >= 3) numbers.push(number);
      });
    }
    
    // Extract any drawing-like patterns from the line
    const patterns = line.match(/[A-Z0-9]{2,}-[A-Z0-9]{2,}/g);
    if (patterns) {
      patterns.forEach(pattern => {
        if (pattern.length >= 5 && pattern.length <= 25 && /[0-9]/.test(pattern)) {
          numbers.push(pattern);
        }
      });
    }
    
    return numbers;
  }
  
  private static extractPotentialDrawingNumbers(line: string): string[] {
    const numbers: string[] = [];
    
    // Look for common drawing number patterns with enhanced matching
    const patterns = [
      /[A-Z]{1,4}[0-9]{4,8}-[A-Z]{1,3}[0-9]{3,8}/g, // KA21941-A004002
      /[0-9]{3,5}-[0-9]{3,5}[A-Z]*/g, // 110-510, 7005-0040
      /[A-Z]{2,}[0-9]{2,}-[A-Z0-9]{2,}/g, // General pattern
      /[A-Z0-9]{3,}-[A-Z0-9]{3,}/g, // Very broad pattern
      // OCR error patterns
      /[A-Z0-9]{2,}[-_][A-Z0-9]{2,}/g, // dash might be underscore
      /[A-Z0-9]{2,}\s+[A-Z0-9]{2,}/g // dash might be space
    ];
    
    patterns.forEach(pattern => {
      const matches = line.match(pattern);
      if (matches) {
        matches.forEach(match => {
          // Clean up the match
          const cleanMatch = match.replace(/\s+/g, '-').replace(/_/g, '-');
          if (cleanMatch.length >= 5 && cleanMatch.length <= 25 && /[0-9]/.test(cleanMatch)) {
            numbers.push(cleanMatch);
          }
        });
      }
    });
    
    // Additional pattern: Look for any sequence that could be a drawing number
    const possibleNumbers = line.match(/[A-Z0-9]{3,25}/g);
    if (possibleNumbers) {
      possibleNumbers.forEach(possible => {
        // If it contains both letters and numbers, it might be a drawing number
        if (/[A-Z]/.test(possible) && /[0-9]/.test(possible) && possible.length >= 5) {
          // Try to insert dash in common positions
          const variations = [
            possible.replace(/([A-Z]+)([0-9]+)/, '$1-$2'),
            possible.replace(/([0-9]+)([A-Z]+)/, '$1-$2'),
            possible.replace(/([A-Z0-9]{3,4})([A-Z0-9]{3,})/, '$1-$2')
          ];
          
          variations.forEach(variation => {
            if (variation.includes('-') && variation.length <= 25) {
              numbers.push(variation);
            }
          });
        }
      });
    }
    
    return [...new Set(numbers)]; // Remove duplicates
  }
  
  private static extractDrawingNumbersByContext(text: string): string[] {
    const numbers: string[] = [];
    
    // Look for patterns that are likely drawing numbers based on context
    const contextPatterns = [
      /(?:drawing|図面|dwg).{0,50}?([A-Z0-9\-_.]{5,25})/gi,
      /([A-Z0-9\-_.]{5,25}).{0,20}(?:drawing|図面|dwg)/gi
    ];
    
    contextPatterns.forEach(pattern => {
      const matches = Array.from(text.matchAll(pattern));
      matches.forEach(match => {
        if (match[1] && /[0-9]/.test(match[1]) && /-/.test(match[1])) {
          numbers.push(match[1]);
        }
      });
    });
    
    return numbers;
  }
  /**
   * Extract meaningful text from OCR results
   */
  static filterMeaningfulText(text: string, confidence: number): FilteredText {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    const filtered: FilteredText = {
      drawingNumbers: [],
      dates: [],
      dimensions: [],
      technicalSpecs: [],
      japaneseText: [],
      companyInfo: [],
      materialInfo: [],
      confidence,
      originalText: text
    };
    
    // SUPER PRIORITY: Use context-aware drawing number extraction
    const contextDrawingNumbers = this.extractDrawingNumbersWithContext(text);
    filtered.drawingNumbers.push(...contextDrawingNumbers);
    
    for (const line of lines) {
      // Skip source headers
      if (line.startsWith('[') && line.includes('dpi]')) continue;
      if (line.includes('confidence:') && line.includes('%')) continue;
      if (line === '---') continue;
      
      // SUPER PRIORITY: Drawing numbers after labels (Drawing No:, 図面No:, etc.)
      // Pattern for labeled drawing numbers - multiple variations
      const labeledDrawingMatch = line.match(/(Drawing\s*No\.?:?\s*|Drawing\s*Number\s*:?\s*|図面\s*No\.?:?\s*|図面番号\s*:?\s*|DWG\s*No\.?:?\s*|DWG\s*#\s*:?\s*)([A-Z0-9\-_.]+)/gi);
      if (labeledDrawingMatch) {
        const numbers = labeledDrawingMatch.map(match => {
          // Extract just the number part after the label
          const numberPart = match.replace(/(Drawing\s*No\.?:?\s*|Drawing\s*Number\s*:?\s*|図面\s*No\.?:?\s*|図面番号\s*:?\s*|DWG\s*No\.?:?\s*|DWG\s*#\s*:?\s*)/gi, '').trim();
          return numberPart;
        }).filter(num => num.length > 2 && num.length < 30);
        if (numbers.length > 0) {
          filtered.drawingNumbers.push(...numbers);
          continue;
        }
      }
      
      // Additional check for lines containing drawing number keywords
      if (/drawing\s*no|drawing\s*number|図面\s*no|図面番号|dwg\s*no/i.test(line)) {
        // Extract any potential drawing numbers from this line
        const potentialNumbers = line.match(/[A-Z0-9]{2,}-[A-Z0-9]{2,}/gi);
        if (potentialNumbers) {
          const validNumbers = potentialNumbers.filter(num => 
            num.length >= 3 && 
            num.length <= 25 &&
            /[0-9]/.test(num) // Must contain at least one number
          );
          if (validNumbers.length > 0) {
            filtered.drawingNumbers.push(...validNumbers);
            continue;
          }
        }
      }
      
      // PRIORITY 1: Drawing numbers (most important - multiple patterns)
      // Pattern 1: Standard drawing numbers (KA21941-A004002)
      const drawingNumberMatch1 = line.match(/[A-Z]{1,3}[0-9]{4,6}-[A-Z][0-9]{3,6}/g);
      if (drawingNumberMatch1) {
        filtered.drawingNumbers.push(...drawingNumberMatch1);
        continue;
      }
      
      // Pattern 2: Extended drawing numbers with more flexible format
      const drawingNumberMatch2 = line.match(/[A-Z]{1,4}[0-9]{2,8}-[A-Z]{1,2}[0-9]{2,8}/g);
      if (drawingNumberMatch2) {
        filtered.drawingNumbers.push(...drawingNumberMatch2);
        continue;
      }
      
      // Pattern 3: Part numbers with specific patterns (110-510, 352-3254)
      const partNumberMatch = line.match(/[0-9]{3,4}-[0-9]{3,4}[A-Z]?L?/g);
      if (partNumberMatch) {
        filtered.drawingNumbers.push(...partNumberMatch);
        continue;
      }
      
      // Pattern 4: Complex part numbers (7195-0006, 1110-4560L)
      const complexPartMatch = line.match(/[0-9]{4,5}-[0-9]{4}[A-Z]*/g);
      if (complexPartMatch) {
        filtered.drawingNumbers.push(...complexPartMatch);
        continue;
      }
      
      // Pattern 5: Any alphanumeric with dash pattern (catch remaining)
      const generalDrawingMatch = line.match(/[A-Z0-9]{2,}-[A-Z0-9]{2,}/g);
      if (generalDrawingMatch) {
        // Filter out obviously non-drawing numbers
        const validDrawingNumbers = generalDrawingMatch.filter(match => 
          match.length >= 5 && 
          match.length <= 20 &&
          /[0-9]/.test(match) && // Must contain at least one number
          !/^[0-9]+-[0-9]+$/.test(match) || match.includes('KA') || match.includes('A0') // Exclude pure numeric unless specific patterns
        );
        if (validDrawingNumbers.length > 0) {
          filtered.drawingNumbers.push(...validDrawingNumbers);
          continue;
        }
      }
      
      // Dates (various formats)
      const dateMatch = line.match(/[0-9]{2,4}[/\-.][0-9]{1,2}[/\-.][0-9]{1,4}/g);
      if (dateMatch) {
        filtered.dates.push(...dateMatch);
        continue;
      }
      
      // Dimensions and measurements
      const dimensionMatch = line.match(/φ?[0-9]+\.?[0-9]*[A-Z]?/g);
      if (dimensionMatch && dimensionMatch.some(d => d.length >= 2)) {
        filtered.dimensions.push(...dimensionMatch.filter(d => d.length >= 2));
        continue;
      }
      
      // Technical specifications
      const techSpecMatch = line.match(/[0-9]+-M[0-9]+[A-Z]*-?[A-Z]*\(?[0-9.]*[A-Z]?\)?/g);
      if (techSpecMatch) {
        filtered.technicalSpecs.push(...techSpecMatch);
        continue;
      }
      
      // Material specifications
      if (this.isMaterialInfo(line)) {
        filtered.materialInfo.push(line);
        continue;
      }
      
      // Company information
      if (this.isCompanyInfo(line)) {
        filtered.companyInfo.push(line);
        continue;
      }
      
      // Japanese text (meaningful sentences)
      if (this.isJapaneseText(line) && line.length >= 2) {
        filtered.japaneseText.push(line);
        continue;
      }
    }
    
    // Remove duplicates
    filtered.drawingNumbers = [...new Set(filtered.drawingNumbers)];
    filtered.dates = [...new Set(filtered.dates)];
    filtered.dimensions = [...new Set(filtered.dimensions)];
    filtered.technicalSpecs = [...new Set(filtered.technicalSpecs)];
    filtered.japaneseText = [...new Set(filtered.japaneseText)];
    filtered.companyInfo = [...new Set(filtered.companyInfo)];
    filtered.materialInfo = [...new Set(filtered.materialInfo)];
    
    return filtered;
  }
  
  private static isMaterialInfo(text: string): boolean {
    const materialKeywords = ['フレーム', '材料', 'ステンレス', 'アルミ', '鋼', '樹脂'];
    return materialKeywords.some(keyword => text.includes(keyword));
  }
  
  private static isCompanyInfo(text: string): boolean {
    const companyKeywords = ['株式会社', '会社', 'Corporation', 'Co.', 'Ltd.', 'Inc.'];
    return companyKeywords.some(keyword => text.includes(keyword));
  }
  
  private static isJapaneseText(text: string): boolean {
    const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
    return japaneseRegex.test(text) && 
           !text.match(/^[a-zA-Z0-9\s\-_.()]+$/) && 
           text.length > 1;
  }
  
  /**
   * Format filtered results for display
   */
  static formatFilteredResults(filtered: FilteredText): string {
    const sections: string[] = [];
    
    if (filtered.drawingNumbers.length > 0) {
      sections.push(`🎯 【最重要】図面番号・部品番号:\n${filtered.drawingNumbers.map(num => `  ★ ${num}`).join('\n')}`);
    }
    
    if (filtered.dates.length > 0) {
      sections.push(`📅 日付:\n${filtered.dates.map(date => `  • ${date}`).join('\n')}`);
    }
    
    if (filtered.dimensions.length > 0) {
      sections.push(`📏 寸法・仕様:\n${filtered.dimensions.map(dim => `  • ${dim}`).join('\n')}`);
    }
    
    if (filtered.technicalSpecs.length > 0) {
      sections.push(`⚙️ 技術仕様:\n${filtered.technicalSpecs.map(spec => `  • ${spec}`).join('\n')}`);
    }
    
    if (filtered.materialInfo.length > 0) {
      sections.push(`🔧 材料情報:\n${filtered.materialInfo.map(mat => `  • ${mat}`).join('\n')}`);
    }
    
    if (filtered.companyInfo.length > 0) {
      sections.push(`🏢 会社情報:\n${filtered.companyInfo.map(company => `  • ${company}`).join('\n')}`);
    }
    
    if (filtered.japaneseText.length > 0) {
      sections.push(`📝 その他のテキスト:\n${filtered.japaneseText.map(text => `  • ${text}`).join('\n')}`);
    }
    
    return sections.join('\n\n');
  }
}
