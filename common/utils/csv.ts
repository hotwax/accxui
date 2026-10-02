import { saveAs } from 'file-saver';
import Papa from 'papaparse';
import Encoding from 'encoding-japanese';


export interface JsonToCsvOption {
  parse?: object | null;
  encode?: object | null;
  name?: string;
  download?: boolean;
}

const downloadCsv = (csv: any, fileName: any) => {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  saveAs(blob, fileName ? fileName : "default.csv");
  return blob;
};

const jsonToCsv = (file: any, options: JsonToCsvOption = {}) => {
  const csv = Papa.unparse(file, {
    ...options.parse
  });
  const encoding = {
    type: String,
    default: "utf-8",
    ...options.encode
  } as any;

  let buffer: Uint8Array;
  let blob: Blob;
  if (encoding.default === 'shift-jis') {
    buffer = new Uint8Array(Encoding.convert(Encoding.stringToCode(csv), 'SJIS'));
    blob = new Blob([buffer as any], { type: `application/csv;charset=${encoding.default}` });

  } else {
    blob = new Blob([csv], { type: `application/csv;charset=${encoding.default}` });
  }

  if (options.download) {
    saveAs(blob, options.name ? options.name : "default.csv");
  }
  return blob;
}


// Utility for parsing CSV file 
// Package Used : PapaParse (Link to Documentation : https://www.papaparse.com/docs#config)

// In this we will be receiving the file and options in the function 
// and we are returning a promise with results in it 

// We have used the parse method of the papaparse library which will take a config object with File.
// In the config object we have passed various keys:
//   - header : It tells papaparse that there will be a header in the CSV. 
//   - skipEmptyLines : It will ignore any empty lines in the CSV.
//   - complete : A parse result always contains three objects: data, errors, and meta. 
//     data and errors are arrays, and meta is an object. In the step callback, the data 
//     array will only contain one element.

// Also, we have passed options, as if user wants to add some more properties to the method 
// or if he want to modify some pre-build keys then he can do so.

// Types of Responses

// CSV FILE :
// columnA,columnB,columnC
// "Susan",41,a
// "Mike",5,b
// "Jake",33,c
// "Jill",30,d

// For (header:true) we get
// [{columnA: 'Susan', columnB: '41', columnC: 'a'},
// {columnA: 'Mike', columnB: '5', columnC: 'b'},
// {columnA: 'Jake', columnB: '33', columnC: 'c'},
// {columnA: 'Jill', columnB: '30', columnC: 'd'}]

// // For (header:false) we get
// [['columnA', 'columnB', 'columnC'],
// ['Susan', '41', 'a'],
// ['Mike', '5', 'b'],
// ['Jake', '33', 'c'],
// ['Jill', '30', 'd']]

const parseCsv = async (file: File, options?: any) => {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: function (results: any) {
        if (results.errors.length) {
          reject(results.error)
        } else {
          resolve(results.data)
        }
      },
      ...options
    });
  })
}
export { downloadCsv, jsonToCsv, parseCsv };
